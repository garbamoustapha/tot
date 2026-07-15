// Engine.cs — Moteur de tournoi : match unique + round-robin (Axelrod).
// --------------------------------------------------------------------------
// Port fidèle de app/js/engine.js.  Round-robin avec self-play (i <= j),
// sur les 5 longueurs de manches.  Classement par score moyen par tour
// (métrique équitable quelle que soit la longueur des manches).
namespace PdArena;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

public static class Engine
{
    /// <summary>Force toute valeur retournée vers 0 ou 1.  Invalide -> forfait (trahir).</summary>
    public static (int move, bool fault) SanitizeMove(int mv)
    {
        if (mv == 0 || mv == 1) return (mv, false);
        return (Pd.Defect, true);
    }

    /// <summary>Joue un match de <paramref name="length"/> tours entre deux stratégies.</summary>
    /// <param name="turnTimeoutMs">Temps réel max par tour (0 = illimité).  Un dépassement
    /// vaut coup forfait (trahir) + faute — filet de sécurité anti-boucle infinie.</param>
    public static MatchResult PlayMatch(
        IPdStrategy stratA, IPdStrategy stratB, int length,
        Random rng, int turnTimeoutMs = 150,
        Action<int, int, int>? onTurn = null)
    {
        var instA = stratA.CreateInstance();
        var instB = stratB.CreateInstance();
        int lastA = Pd.NoMove, lastB = Pd.NoMove;
        int scoreA = 0, scoreB = 0, faultsA = 0, faultsB = 0;

        for (int turn = 1; turn <= length; turn++)
        {
            var ctxA = new PdCtx(lastB, turn, scoreA, scoreB, rng.NextDouble(), lastA);
            var ctxB = new PdCtx(lastA, turn, scoreB, scoreA, rng.NextDouble(), lastB);

            int rawA = DecideSafe(instA, ctxA, turnTimeoutMs, ref faultsA);
            int rawB = DecideSafe(instB, ctxB, turnTimeoutMs, ref faultsB);

            int mA = SanitizeMove(rawA).move;
            int mB = SanitizeMove(rawB).move;

            scoreA += Pd.Payoff[mA, mB];
            scoreB += Pd.Payoff[mB, mA];
            lastA = mA;
            lastB = mB;
            onTurn?.Invoke(turn, mA, mB);
        }

        string winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "DRAW";
        return new MatchResult
        {
            ScoreA = scoreA, ScoreB = scoreB, Length = length,
            FaultsA = faultsA, FaultsB = faultsB, Winner = winner,
        };
    }

    // Appelle Decide avec un timeout temps-réel par tour.  En cas de dépassement ou
    // d'exception, renvoie un coup forfait (trahir) et incrémente le compteur de fautes.
    private static int DecideSafe(IPdInstance inst, PdCtx ctx, int timeoutMs, ref int faults)
    {
        if (timeoutMs <= 0)
        {
            try { return inst.Decide(ctx); }
            catch { faults++; return Pd.Defect; }
        }
        var task = Task.Run(() => inst.Decide(ctx));
        if (!task.Wait(timeoutMs))
        {
            faults++;
            return Pd.Defect; // timeout -> coup forfait
        }
        if (task.IsFaulted)
        {
            faults++;
            return Pd.Defect;
        }
        return task.Result;
    }

    /// <summary>
    /// Tournoi round-robin : chaque stratégie affronte toutes les autres ET elle-même
    /// (self-play inclus), sur les 5 longueurs.  Renvoie le classement 1er -> dernier.
    /// </summary>
    /// <param name="onPairDone">Appelé après chaque paire (i,j) avec (done, totalPairs, snapshot des stats).</param>
    public static List<StratStat> RoundRobin(
        IReadOnlyList<IPdStrategy> strategies,
        int seed,
        int reps = 1,
        Action<int, int, List<StratStat>>? onPairDone = null,
        Action<int, int, MatchResult>? onResult = null)
    {
        int n = strategies.Count;
        var stats = new List<StratStat>(n);
        for (int i = 0; i < n; i++)
        {
            var m = strategies[i].Meta;
            stats.Add(new StratStat
            {
                Index = i,
                Id = m.Id,
                Name = m.Name,
                Icon = m.Icon,
                Type = m.Type,
                IsUser = m.IsUser,
                PlayerName = m.PlayerName,
            });
        }

        var rng = new Random(seed);
        int totalPairs = n * (n + 1) / 2; // i <= j, self-play inclus
        int done = 0;

        for (int i = 0; i < n; i++)
        {
            for (int j = i; j < n; j++)
            {
                foreach (var len in Pd.Lengths)
                {
                    for (int r = 0; r < reps; r++)
                    {
                        // Graine par match pour la reproductibilité (anti-triche).
                        var res = PlayMatch(strategies[i], strategies[j], len,
                            new Random(rng.Next()));
                        stats[i].TotalScore += res.ScoreA;
                        stats[i].TotalTurns += len;
                        stats[i].Matches++;
                        stats[j].TotalScore += res.ScoreB;
                        stats[j].TotalTurns += len;
                        stats[j].Matches++;
                        onResult?.Invoke(i, j, res);
                        if (i != j)
                        {
                            if (res.ScoreA > res.ScoreB) { stats[i].Wins++; stats[j].Losses++; }
                            else if (res.ScoreA < res.ScoreB) { stats[i].Losses++; stats[j].Wins++; }
                            else { stats[i].Ties++; stats[j].Ties++; }
                        }
                    }
                }
                done++;
                onPairDone?.Invoke(done, totalPairs, stats);
            }
        }

        foreach (var s in stats)
        {
            s.AvgPerTurn = s.TotalTurns > 0 ? (double)s.TotalScore / s.TotalTurns : 0;
            s.AvgPerMatch = s.Matches > 0 ? (double)s.TotalScore / s.Matches : 0;
        }
        stats.Sort((a, b) =>
            b.AvgPerTurn.CompareTo(a.AvgPerTurn) != 0 ? b.AvgPerTurn.CompareTo(a.AvgPerTurn)
            : b.TotalScore.CompareTo(a.TotalScore));
        for (int i = 0; i < stats.Count; i++) stats[i].Rank = i + 1;
        return stats;
    }
}