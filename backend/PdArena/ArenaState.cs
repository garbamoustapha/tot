// ArenaState.cs — État partagé de l'arène (singleton) entre le hub SignalR et
// le service de tournoi : classement courant, prochain tournoi, statut.
namespace PdArena;

using System;
using System.Collections.Generic;
using System.Threading;

public sealed class ArenaState
{
    private readonly object _lock = new();
    private List<LeaderboardRow> _leaderboard = new();
    private List<DuelCell> _duels = new();
    private DateTime _nextTournamentAt = DateTime.UtcNow;
    private string _status = "idle";        // idle | running
    private int _lastProgressDone;
    private int _lastProgressTotal;
    private string _lastTournamentId = "";

    public List<LeaderboardRow> Snapshot()
    {
        lock (_lock) return _leaderboard.ToList();
    }

    public void SetLeaderboard(List<LeaderboardRow> rows)
    {
        lock (_lock) _leaderboard = rows;
    }

    /// <summary>Matrice des duels du dernier tournoi (paires i &lt; j, self-play exclu).</summary>
    public List<DuelCell> DuelsSnapshot()
    {
        lock (_lock) return _duels.ToList();
    }

    public void SetDuels(List<DuelCell> duels)
    {
        lock (_lock) _duels = duels;
    }

    public DateTime NextTournamentAt
    {
        get { lock (_lock) return _nextTournamentAt; }
        set { lock (_lock) _nextTournamentAt = value; }
    }

    public string Status
    {
        get { lock (_lock) return _status; }
        set { lock (_lock) _status = value; }
    }

    public (int done, int total) Progress
    {
        get { lock (_lock) return (_lastProgressDone, _lastProgressTotal); }
        set { lock (_lock) { _lastProgressDone = value.done; _lastProgressTotal = value.total; } }
    }

    public string LastTournamentId
    {
        get { lock (_lock) return _lastTournamentId; }
        set { lock (_lock) _lastTournamentId = value; }
    }

    public int RemainingSeconds()
    {
        var s = NextTournamentAt - DateTime.UtcNow;
        return s > TimeSpan.Zero ? (int)Math.Ceiling(s.TotalSeconds) : 0;
    }
}