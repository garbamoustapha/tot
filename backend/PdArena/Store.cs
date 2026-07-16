// Store.cs — Persistance des stratégies soumises dans SQL Server.
// --------------------------------------------------------------------------
// Toute la persistance passe par la base MonsterASP (databaseasp.net).  Aucun
// stockage fichier : le store est 100 % SQL, en local comme en production.
//
// Modèle : chaque joueur a au plus une stratégie publiée (la dernière soumission
// remplace la précédente, à la Axelrod) — d'où PlayerName comme clé primaire
// (collation par défaut = insensible à la casse, donc « Bob » == « bob »).
namespace PdArena;

using System;
using System.Collections.Generic;
using System.Threading;
using Microsoft.Data.SqlClient;

public sealed class SubmissionDto
{
    public string PlayerName { get; set; } = "";
    public string AlgoName { get; set; } = "";
    public string IconId { get; set; } = "";
    public string Code { get; set; } = "";
}

/// <summary>Paramètres du rejouage d'un match (animation côté client).</summary>
public sealed class ReplayDto
{
    public string AId { get; set; } = "";
    public string BId { get; set; } = "";
    public int Length { get; set; }
    public int Seed { get; set; }
}

/// <summary>Stratégie soumise persistée (sans l'instance compilée).</summary>
public sealed class StoredStrategy
{
    public string Id { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public string AlgoName { get; set; } = "";
    public string IconId { get; set; } = "";
    public string IconGlyph { get; set; } = "";
    public string Code { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public DateTime SubmittedAt { get; set; }
}

public sealed class StoredStrategyPublic
{
    public string Id { get; init; } = "";
    public string PlayerName { get; init; } = "";
    public string AlgoName { get; init; } = "";
    public string IconGlyph { get; init; } = "";
    public DateTime SubmittedAt { get; init; }
}

public sealed class StrategyStore
{
    private readonly string _connStr;

    // Stratégies utilisateur actuellement compilées (vivantes pendant un tournoi).
    // Id -> (strategy, unload).  Recompilées à chaque tournoi.  Cache en mémoire
    // (les assemblées Roslyn ne se sérialisent pas) protégé par _liveLock.
    private readonly object _liveLock = new();
    private readonly Dictionary<string, (UserStrategy strat, Action unload)> _live = new();

    // Schéma créé une seule fois par process (best-effort, ré-essayé si échec).
    private int _schemaReady;

    public StrategyStore(string connectionString)
    {
        _connStr = connectionString
            ?? throw new ArgumentNullException(nameof(connectionString),
                "Chaîne de connexion SQL manquante (ConnectionStrings:Default).");
    }

    /// <summary>Ouvre une connexion et garantit l'existence du schéma.</summary>
    private SqlConnection Open()
    {
        var c = new SqlConnection(_connStr);
        c.Open();
        EnsureSchema(c);
        return c;
    }

    /// <summary>Crée la table dbo.Strategies si absente (idempotent).</summary>
    private void EnsureSchema(SqlConnection c)
    {
        if (Interlocked.CompareExchange(ref _schemaReady, 1, 0) != 0) return;
        try
        {
            const string ddl = @"
IF OBJECT_ID('dbo.Strategies','U') IS NULL
CREATE TABLE dbo.Strategies (
    PlayerName   NVARCHAR(200) NOT NULL CONSTRAINT PK_Strategies PRIMARY KEY,
    Id           NVARCHAR(64)  NOT NULL,
    AlgoName     NVARCHAR(200) NOT NULL,
    IconId       NVARCHAR(100) NOT NULL,
    IconGlyph    NVARCHAR(50)  NOT NULL,
    Code         NVARCHAR(MAX) NOT NULL,
    CodeHash     NVARCHAR(100) NOT NULL,
    SubmittedAt  DATETIME2     NOT NULL
);";
            using var cmd = new SqlCommand(ddl, c);
            cmd.ExecuteNonQuery();
        }
        catch
        {
            _schemaReady = 0; // permet un nouvel essai à la prochaine requête
            throw;
        }
    }

    private static StoredStrategy Read(SqlDataReader r) => new()
    {
        PlayerName = r.GetString(0),
        Id = r.GetString(1),
        AlgoName = r.GetString(2),
        IconId = r.GetString(3),
        IconGlyph = r.GetString(4),
        Code = r.GetString(5),
        CodeHash = r.GetString(6),
        SubmittedAt = r.GetDateTime(7),
    };

    private const string SelectAll =
        "SELECT PlayerName, Id, AlgoName, IconId, IconGlyph, Code, CodeHash, SubmittedAt " +
        "FROM dbo.Strategies ORDER BY SubmittedAt ASC";

    /// <summary>Liste publique (sans le code source) — tolérante aux pannes DB.</summary>
    public List<StoredStrategyPublic> ListPublic()
    {
        var list = new List<StoredStrategyPublic>();
        try
        {
            using var c = Open();
            using var cmd = new SqlCommand(SelectAll, c);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var s = Read(r);
                list.Add(new StoredStrategyPublic
                {
                    Id = s.Id,
                    PlayerName = s.PlayerName,
                    AlgoName = s.AlgoName,
                    IconGlyph = s.IconGlyph,
                    SubmittedAt = s.SubmittedAt,
                });
            }
        }
        catch (Exception ex) { LogDbError(nameof(ListPublic), ex); }
        return list;
    }

    /// <summary>Toutes les stratégies stockées (code inclus) — tolérante aux pannes DB.</summary>
    public IReadOnlyList<StoredStrategy> All()
    {
        var list = new List<StoredStrategy>();
        try
        {
            using var c = Open();
            using var cmd = new SqlCommand(SelectAll, c);
            using var r = cmd.ExecuteReader();
            while (r.Read()) list.Add(Read(r));
        }
        catch (Exception ex) { LogDbError(nameof(All), ex); }
        return list;
    }

    /// <summary>Enregistre (ou remplace) la stratégie d'un joueur.  Propage les erreurs DB.</summary>
    public StoredStrategy Upsert(string playerName, string algoName, string iconId, string code)
    {
        var icon = IconCatalog.ById(iconId) ?? IconCatalog.All[0];
        var hash = Sha256(code);
        var entry = new StoredStrategy
        {
            Id = $"u_{hash[..12]}",
            PlayerName = playerName.Trim(),
            AlgoName = algoName.Trim(),
            IconId = icon.Id,
            IconGlyph = icon.Glyph,
            Code = code,
            CodeHash = hash,
            SubmittedAt = DateTime.UtcNow,
        };

        using var c = Open();
        using var tx = c.BeginTransaction();
        // Un joueur = une stratégie publiée : la dernière remplace (DELETE puis INSERT).
        using (var del = new SqlCommand("DELETE FROM dbo.Strategies WHERE PlayerName = @p", c, tx))
        {
            del.Parameters.AddWithValue("@p", entry.PlayerName);
            del.ExecuteNonQuery();
        }
        using (var ins = new SqlCommand(
            "INSERT INTO dbo.Strategies (PlayerName, Id, AlgoName, IconId, IconGlyph, Code, CodeHash, SubmittedAt) " +
            "VALUES (@p, @id, @algo, @iid, @glyph, @code, @hash, @at)", c, tx))
        {
            ins.Parameters.AddWithValue("@p", entry.PlayerName);
            ins.Parameters.AddWithValue("@id", entry.Id);
            ins.Parameters.AddWithValue("@algo", entry.AlgoName);
            ins.Parameters.AddWithValue("@iid", entry.IconId);
            ins.Parameters.AddWithValue("@glyph", entry.IconGlyph);
            ins.Parameters.AddWithValue("@code", entry.Code);
            ins.Parameters.AddWithValue("@hash", entry.CodeHash);
            ins.Parameters.AddWithValue("@at", entry.SubmittedAt);
            ins.ExecuteNonQuery();
        }
        tx.Commit();
        return entry;
    }

    /// <summary>Compile toutes les stratégies stockées en instances vivantes IPdStrategy.</summary>
    public List<IPdStrategy> BuildLiveStrategies(out List<string> errors)
    {
        errors = new();
        var result = new List<IPdStrategy>();

        lock (_liveLock)
        {
            // Décharge les anciennes instances compilées.
            foreach (var kv in _live) kv.Value.unload();
            _live.Clear();

            foreach (var s in All())
            {
                if (!UserStrategyCompiler.TryCompile(s.Code, new StratMeta
                {
                    Id = s.Id,
                    Name = s.AlgoName,
                    Icon = s.IconGlyph,
                    Type = "user",
                    IsUser = true,
                    PlayerName = s.PlayerName,
                }, out var strat, out var err))
                {
                    errors.Add($"{s.PlayerName}/{s.AlgoName}: {err}");
                    continue;
                }
                var us = (UserStrategy)strat;
                _live[s.Id] = (us, us.Unload);
                result.Add(us);
            }
        }
        return result;
    }

    /// <summary>Nombre de stratégies stockées — tolérant aux pannes DB.</summary>
    public int Count
    {
        get
        {
            try
            {
                using var c = Open();
                using var cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Strategies", c);
                return Convert.ToInt32(cmd.ExecuteScalar());
            }
            catch (Exception ex) { LogDbError(nameof(Count), ex); return 0; }
        }
    }

    /// <summary>Diagnostic : tente connexion + schéma + comptage.  Retourne null si OK,
    /// sinon un message d'erreur sûr (type + message, sans mot de passe ni stack).</summary>
    public string? Diagnose()
    {
        try
        {
            using var c = Open(); // ouvre + EnsureSchema (CREATE TABLE si absent)
            using var cmd = new SqlCommand("SELECT COUNT(*) FROM dbo.Strategies", c);
            cmd.ExecuteScalar();
            return null;
        }
        catch (Exception ex)
        {
            return $"{ex.GetType().Name}: {ex.Message}";
        }
    }

    private static void LogDbError(string op, Exception ex) =>
        Console.Error.WriteLine($"[StrategyStore.{op}] erreur SQL : {ex.Message}");

    private static string Sha256(string text)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
