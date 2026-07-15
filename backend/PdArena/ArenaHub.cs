// ArenaHub.cs — Hub SignalR de l'arène en ligne.  Canal temps réel vers le
// frontend : compte à rebours, démarrage/progression/fin du tournoi, classement
// live, et notifications de soumission (fun & fluide).
// --------------------------------------------------------------------------
// Méthodes client (reçues par le navigateur) :
//   ReceiveHello         (état initial : classement + prochain tournoi + statut)
//   ReceiveCountdown     (remainingSeconds, nextTournamentAtIso)
//   ReceiveTournamentStart (tournamentId, strategyCount)
//   ReceiveProgress      (done, total, partialRows)
//   ReceiveLeaderboard   (rows)            // classement final ou rafraîchi
//   ReceiveSubmission    (playerName, algoName, iconGlyph, totalStrategies)
//   ReceiveStatus        (status)
namespace PdArena;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

public class ArenaHub : Hub
{
    public const string Group = "arena";
    private readonly ArenaState _state;

    public ArenaHub(ArenaState state) { _state = state; }

    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, Group);
        // Envoi de l'état initial au nouveau connecté (hello + countdown immédiat).
        await Clients.Caller.SendAsync("ReceiveHello", new
        {
            leaderboard = _state.Snapshot(),
            duels = _state.DuelsSnapshot(),
            nextTournamentAt = _state.NextTournamentAt.ToString("o"),
            remainingSeconds = _state.RemainingSeconds(),
            status = _state.Status,
            progress = new { done = _state.Progress.done, total = _state.Progress.total },
        });
        await base.OnConnectedAsync();
    }
}