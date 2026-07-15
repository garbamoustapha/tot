// Domain.cs — Types partagés du moteur de tournoi PD Arena.
// --------------------------------------------------------------------------
// Encodage des coups : 0 = Coopérer, 1 = Trahir.  -1 = "pas de coup précédent"
// au tour 1.  Matrice de gain (T,R,P,S) = (5,3,1,0) — conforme à TourExec.
namespace PdArena;

using System.Collections.Generic;

/// <summary>Contexte passé à une stratégie à chaque tour (signature Axelrod).</summary>
public readonly record struct PdCtx(
    int OpponentLastMove,   // -1 au tour 1
    int CurrentTurn,        // >= 1
    int MyScore,
    int OpponentScore,
    double RandomValue,     // ∈ [0,1)
    int MyLastMove);        // -1 au tour 1

/// <summary>Instance stateful d'une stratégie, fraîche pour un match.</summary>
public interface IPdInstance
{
    int Decide(PdCtx ctx);
}

/// <summary>
/// Usine de stratégies : produit une <see cref="IPdInstance"/> fraîche par match.
/// L'état persiste d'un tour à l'autre dans l'instance (équivalent -fno-automatic).
/// </summary>
public interface IPdStrategy
{
    StratMeta Meta { get; }
    IPdInstance CreateInstance();
}

/// <summary>Méta-données d'affichage d'une stratégie.</summary>
public sealed class StratMeta
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Icon { get; init; } = "•";
    /// <summary>"nice" | "mean" | "noisy" | "user"</summary>
    public string Type { get; init; } = "user";
    public string Behavior { get; init; } = "";
    public bool IsUser { get; init; }
    /// <summary>Nom du joueur (pour les stratégies soumises).</summary>
    public string PlayerName { get; init; } = "";
}

/// <summary>Résultat d'un match unique.</summary>
public sealed class MatchResult
{
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public int Length { get; init; }
    public int FaultsA { get; init; }
    public int FaultsB { get; init; }
    public string Winner { get; init; } = "DRAW"; // "A" | "B" | "DRAW"
}

/// <summary>Statistiques agrégées d'une stratégie sur un tournoi round-robin.</summary>
public sealed class StratStat
{
    public int Index { get; set; }
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "•";
    public string Type { get; set; } = "user";
    public bool IsUser { get; set; }
    public string PlayerName { get; set; } = "";
    public int TotalScore { get; set; }
    public int TotalTurns { get; set; }
    public int Matches { get; set; }
    public int Wins { get; set; }
    public int Ties { get; set; }
    public int Losses { get; set; }
    public int Rank { get; set; }
    public double AvgPerTurn { get; set; }
    public double AvgPerMatch { get; set; }

    public LeaderboardRow ToRow() => new()
    {
        Rank = Rank,
        Id = Id,
        Name = Name,
        Icon = Icon,
        Type = Type,
        IsUser = IsUser,
        PlayerName = PlayerName,
        AvgPerTurn = AvgPerTurn,
        TotalScore = TotalScore,
        Matches = Matches,
        Wins = Wins,
        Ties = Ties,
        Losses = Losses,
    };

    public StratStat Clone() => new()
    {
        Index = Index, Id = Id, Name = Name, Icon = Icon, Type = Type,
        IsUser = IsUser, PlayerName = PlayerName,
        TotalScore = TotalScore, TotalTurns = TotalTurns, Matches = Matches,
        Wins = Wins, Ties = Ties, Losses = Losses, Rank = Rank,
        AvgPerTurn = AvgPerTurn, AvgPerMatch = AvgPerMatch,
    };
}

/// <summary>Ligne de classement sérialisée vers le frontend.</summary>
public sealed class LeaderboardRow
{
    public int Rank { get; init; }
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Icon { get; init; } = "•";
    public string Type { get; init; } = "user";
    public bool IsUser { get; init; }
    public string PlayerName { get; init; } = "";
    public double AvgPerTurn { get; init; }
    public int TotalScore { get; init; }
    public int Matches { get; init; }
    public int Wins { get; init; }
    public int Ties { get; init; }
    public int Losses { get; init; }
}

/// <summary>
/// Résultat agrégé d'un duel (paire de stratégies) sur les 5 manches du tournoi.
/// AId = stratégie d'indice i, BId = stratégie d'indice j (i &lt;= j, self-play exclu).
/// Sert au frontend pour afficher « la partie qu'il a jouée » au clic sur une ligne.
/// </summary>
public sealed class DuelCell
{
    public string AId { get; init; } = "";
    public string BId { get; init; } = "";
    public int ScoreA { get; init; }
    public int ScoreB { get; init; }
    public int Turns { get; init; }
    public int WinsA { get; init; }
    public int Ties { get; init; }
    public int WinsB { get; init; }
}

public static class Pd
{
    public const int Cooperate = 0;
    public const int Defect = 1;
    public const int NoMove = -1;
    /// <summary>Longueurs de manches d'Axelrod (TourExec/AxTest.f).</summary>
    public static readonly int[] Lengths = { 63, 77, 151, 156, 308 };

    /// <summary>Matrice de gain (T=5,R=3,P=1,S=0).  Indexé [moveA][moveB].</summary>
    public static readonly int[,] Payoff = {
        { 3, 0 }, // A coopère : 0/0 -> 3, 0/1 -> 0 (S)
        { 5, 1 }, // A trahit   : 1/0 -> 5 (T), 1/1 -> 1 (P)
    };
}