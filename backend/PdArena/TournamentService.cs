// TournamentService.cs — Service hébergé (BackgroundService) qui orchestre les
// tournois horaires de l'arène en ligne et diffuse les évènements temps réel via
// SignalR : compte à rebours, démarrage, progression live, classement final.
// --------------------------------------------------------------------------
// Cadence : un tournoi à chaque heure pleine (HH:00:00).  Au démarrage, un
// premier tournoi est lancé après un court délai pour que l'arène s'anime dès
// l'ouverture, puis la cadence horaire s'installe.  L'intervalle est surchargeable
// via la variable d'environnement ARENA_INTERVAL_SECONDS (pour les démos).
namespace PdArena;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

public class TournamentService : BackgroundService
{
    public const string Group = ArenaHub.Group;
    private readonly IHubContext<ArenaHub> _hub;
    private readonly StrategyStore _store;
    private readonly ArenaState _state;
    private readonly ILogger<TournamentService> _log;

    // Intervalle entre deux tournoi (secondes). Défaut : 1 heure.
    private readonly int _intervalSeconds;
    // Délai du premier tournoi après démarrage (pour animer l'arène à l'ouverture).
    private const int InitialDelaySeconds = 20;

    public TournamentService(IHubContext<ArenaHub> hub, StrategyStore store, ArenaState state, ILogger<TournamentService> log)
    {
        _hub = hub;
        _store = store;
        _state = state;
        _log = log;
        if (!int.TryParse(Environment.GetEnvironmentVariable("ARENA_INTERVAL_SECONDS"), out _intervalSeconds) || _intervalSeconds < 30)
            _intervalSeconds = 3600;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Premier tournoi après un court délai (arène vivante dès l'ouverture).
        _state.NextTournamentAt = DateTime.UtcNow.AddSeconds(InitialDelaySeconds);
        _log.LogInformation("Arène démarrée. Premier tournoi dans {s}s, puis toutes les {i}s.",
            InitialDelaySeconds, _intervalSeconds);

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                // Boucle de compte à rebours (tick toutes les secondes).
                while (!stoppingToken.IsCancellationRequested)
                {
                    int remaining = _state.RemainingSeconds();
                    await _hub.Clients.Group(Group).SendAsync("ReceiveCountdown",
                        remaining, _state.NextTournamentAt.ToString("o"),
                        cancellationToken: stoppingToken);
                    if (remaining <= 0) break;
                    await Task.Delay(1000, stoppingToken);
                }

                if (stoppingToken.IsCancellationRequested) break;
                await RunTournamentAsync(stoppingToken);

                // Programme le prochain tournoi (cadence horaire / intervalle configuré).
                _state.NextTournamentAt = DateTime.UtcNow.AddSeconds(_intervalSeconds);
            }
        }
        catch (TaskCanceledException) { /* arrêt propre */ }
    }

    private async Task RunTournamentAsync(CancellationToken ct)
    {
        var tournamentId = Guid.NewGuid().ToString("N")[..8];
        _state.LastTournamentId = tournamentId;
        _state.Status = "running";
        await _hub.Clients.Group(Group).SendAsync("ReceiveStatus", "running", ct);

        // Construit le pool : stratégies joueurs (compilées) + 19 algorithmes de référence.
        var userStrats = _store.BuildLiveStrategies(out var compileErrors);
        foreach (var e in compileErrors) _log.LogWarning("Stratégie rejetée : {e}", e);

        var strategies = new List<IPdStrategy>();
        strategies.AddRange(userStrats);
        strategies.AddRange(BuiltinStrategies.All);

        _state.Progress = (0, 0);
        await _hub.Clients.Group(Group).SendAsync("ReceiveTournamentStart",
            tournamentId, strategies.Count, ct);

        // Seed stable par tournoi (reproductibilité).
        int seed = (int)(DateTime.UtcNow.Ticks % int.MaxValue);
        if (seed == 0) seed = 1;

        // Diffuse la progression + un classement partiel (animé) tous les K paires.
        int emitEvery = Math.Max(1, (strategies.Count * (strategies.Count + 1) / 2) / 24);
        int lastDone = -1;

        // Accumule la matrice des duels (paires i < j, self-play exclu) pour pouvoir
        // afficher « la partie qu'il a jouée » au clic sur une ligne du classement.
        var duelAcc = new Dictionary<string, (int sa, int sb, int turns, int wa, int ti, int wb)>();

        List<StratStat> final = Engine.RoundRobin(strategies, seed, reps: 1,
            onPairDone: (done, total, stats) =>
            {
                _state.Progress = (done, total);
                // Émet toujours la 1ère paire (animateur dès le départ), la dernière,
                // puis un pas régulier — pour un classement live fluide.
                if (done != total && done != 1 && done - lastDone < emitEvery) return;
                lastDone = done;
                // Classement partiel : copie triée du snapshot courant.
                _ = BroadcastProgressAsync(done, total, stats, ct);
            },
            onResult: (i, j, res) =>
            {
                if (i == j) return; // self-play exclu : duel non significatif
                var key = $"{strategies[i].Meta.Id}|{strategies[j].Meta.Id}"; // i < j => A/B stable
                if (!duelAcc.TryGetValue(key, out var v)) v = (0, 0, 0, 0, 0, 0);
                v = (v.sa + res.ScoreA, v.sb + res.ScoreB, v.turns + res.Length,
                     v.wa + (res.Winner == "A" ? 1 : 0),
                     v.ti + (res.Winner == "DRAW" ? 1 : 0),
                     v.wb + (res.Winner == "B" ? 1 : 0));
                duelAcc[key] = v;
            });

        var rows = final.Select(s => s.ToRow()).ToList();
        var duels = duelAcc.Select(kv =>
        {
            var parts = kv.Key.Split('|');
            return new DuelCell
            {
                AId = parts[0], BId = parts[1],
                ScoreA = kv.Value.sa, ScoreB = kv.Value.sb, Turns = kv.Value.turns,
                WinsA = kv.Value.wa, Ties = kv.Value.ti, WinsB = kv.Value.wb,
            };
        }).ToList();

        _state.SetLeaderboard(rows);
        _state.SetDuels(duels);
        _state.Status = "idle";
        _state.Progress = (0, 0);

        await _hub.Clients.Group(Group).SendAsync("ReceiveProgress",
            final.Count > 0 ? (final.Count * (final.Count + 1) / 2) : 0,
            final.Count > 0 ? (final.Count * (final.Count + 1) / 2) : 0,
            rows, ct);
        await _hub.Clients.Group(Group).SendAsync("ReceiveLeaderboard", rows, tournamentId, ct);
        await _hub.Clients.Group(Group).SendAsync("ReceiveDuels", duels, tournamentId, ct);
        await _hub.Clients.Group(Group).SendAsync("ReceiveStatus", "idle", ct);

        _log.LogInformation("Tournoi {id} terminé : {n} stratégies classées.", tournamentId, rows.Count);
    }

    private async Task BroadcastProgressAsync(int done, int total, List<StratStat> stats, CancellationToken ct)
    {
        try
        {
            // Calcule un classement partiel sans muter l'original.
            var snapshot = stats.Select(s => s.Clone()).ToList();
            foreach (var s in snapshot)
                s.AvgPerTurn = s.TotalTurns > 0 ? (double)s.TotalScore / s.TotalTurns : 0;
            snapshot.Sort((a, b) =>
                b.AvgPerTurn.CompareTo(a.AvgPerTurn) != 0 ? b.AvgPerTurn.CompareTo(a.AvgPerTurn)
                : b.TotalScore.CompareTo(a.TotalScore));
            for (int i = 0; i < snapshot.Count; i++) snapshot[i].Rank = i + 1;
            var rows = snapshot.Select(s => s.ToRow()).ToList();
            await _hub.Clients.Group(Group).SendAsync("ReceiveProgress", done, total, rows, ct);
        }
        catch { /* la diffusion ne doit pas casser le tournoi */ }
    }

    /// <summary>Déclenche un tournoi immédiatement (endpoint manuel / démo).</summary>
    public async Task TriggerNowAsync(CancellationToken ct = default)
    {
        _state.NextTournamentAt = DateTime.UtcNow;
    }
}