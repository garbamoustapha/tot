// Store.cs — Persistance des stratégies soumises + cache du classement.
// --------------------------------------------------------------------------
// Stockage simple JSON (fichier) — suffisant pour l'arène de démo.  Chaque
// joueur a au plus une stratégie publiée (la dernière soumission remplace la
// précédente, à la Axelrod : "le leaderboard ne retient que la dernière version").
namespace PdArena;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;

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
    private readonly object _lock = new();
    private readonly string _file;
    private List<StoredStrategy> _items = new();

    // Stratégies utilisateur actuellement compilées (vivantes pendant un tournoi).
    // Id -> (strategy, unload).  Recompilées à chaque soumission / tournoi.
    private readonly Dictionary<string, (UserStrategy strat, Action unload)> _live = new();

    public StrategyStore(string file)
    {
        _file = file;
        Load();
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_file))
            {
                var json = File.ReadAllText(_file);
                _items = JsonSerializer.Deserialize<List<StoredStrategy>>(json) ?? new();
            }
        }
        catch { _items = new(); }
    }

    private void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(_file);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(_file, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* non bloquant */ }
    }

    public List<StoredStrategyPublic> ListPublic()
    {
        lock (_lock)
            return _items.Select(s => new StoredStrategyPublic
            {
                Id = s.Id,
                PlayerName = s.PlayerName,
                AlgoName = s.AlgoName,
                IconGlyph = s.IconGlyph,
                SubmittedAt = s.SubmittedAt,
            }).ToList();
    }

    public IReadOnlyList<StoredStrategy> All()
    {
        lock (_lock) return _items.ToList();
    }

    /// <summary>Enregistre (ou remplace) la stratégie d'un joueur.  Retourne l'entrée stockée.</summary>
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

        lock (_lock)
        {
            // Un joueur = une stratégie publiée (la dernière remplace).
            _items.RemoveAll(s => s.PlayerName.Equals(entry.PlayerName, StringComparison.OrdinalIgnoreCase));
            _items.Add(entry);
            Save();
        }
        return entry;
    }

    /// <summary>Compile toutes les stratégies stockées en instances vivantes IPdStrategy.</summary>
    public List<IPdStrategy> BuildLiveStrategies(out List<string> errors)
    {
        errors = new();
        var result = new List<IPdStrategy>();
        // Décharge les anciennes instances compilées.
        foreach (var kv in _live) kv.Value.unload();
        _live.Clear();

        List<StoredStrategy> snapshot;
        lock (_lock) snapshot = _items.ToList();

        foreach (var s in snapshot)
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
        return result;
    }

    public int Count { get { lock (_lock) return _items.Count; } }

    private static string Sha256(string text)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}