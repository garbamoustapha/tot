// UserStrategy.cs — Compilation & exécution des stratégies C# soumises par les
// joueurs, via Roslyn (Microsoft.CodeAnalysis.CSharp) en mémoire.
// --------------------------------------------------------------------------
// Sécurité (niveau démo) :
//   - Validation statique : rejette les imports/mots-clés dangereux (réseau, FS,
//     Process, réflexion d'évasion, Environment.Exit…).
//   - Timeout temps-réel par tour (côté Engine) : un dépassement vaut coup forfait.
//   - AssemblyLoadContext collectible : les assemblées compilées sont déchargées
//     après le tournoi (pas de fuite de mémoire sur les soumissions répétées).
namespace PdArena;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

public static class UserStrategyCompiler
{
    /// <summary>Tokens interdits dans le code soumis (validation statique).</summary>
    private static readonly string[] Forbidden =
    {
        "System.Net", "System.IO", "System.Diagnostics.Process",
        "System.Diagnostics.Debugger", "System.Runtime.InteropServices",
        "System.Reflection", "System.Threading", "System.AppDomain",
        "Environment.Exit", "Process.Start", "File.", "Directory.",
        "Console.", "Microsoft.CodeAnalysis", "System.Security",
        "DllImport", "Process.", "System.Management",
    };

    public static bool TryCompile(string code, StratMeta meta, [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out IPdStrategy? strategy, out string error)
    {
        strategy = null;
        error = "";

        // 1) Validation statique (insensible à la casse).
        var lowered = code ?? "";
        foreach (var f in Forbidden)
            if (lowered.IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                error = $"Code interdit détecté : « {f} ». L'arène n'autorise pas l'accès réseau, fichier, processus ou réflexion.";
                return false;
            }

        if (!lowered.Contains("class Player") && !lowered.Contains("class Player "))
        {
            error = "La classe doit s'appeler « Player » (avec une méthode Decide).";
            return false;
        }

        // 2) Compilation Roslyn.
        var tree = CSharpSyntaxTree.ParseText(lowered);
        var refs = new[]
        {
            MetadataReference.CreateFromFile(typeof(object).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(Console).Assembly.Location),
            MetadataReference.CreateFromFile(Assembly.Load("System.Runtime").Location),
        };
        var compilation = CSharpCompilation.Create(
            $"PlayerStrategy_{Guid.NewGuid():N}",
            new[] { tree },
            refs,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary,
                optimizationLevel: OptimizationLevel.Release,
                warningLevel: 0));

        using var ms = new MemoryStream();
        var emit = compilation.Emit(ms);
        if (!emit.Success)
        {
            error = string.Join("\n", emit.Diagnostics
                .Where(d => d.Severity == DiagnosticSeverity.Error)
                .Select(d => d.ToString().Replace("\r", "")));
            if (string.IsNullOrEmpty(error)) error = "Compilation échouée (erreur inconnue).";
            return false;
        }

        ms.Position = 0;
        var alc = new CollectibleAssemblyLoadContext();
        var asm = alc.LoadFromStream(ms);
        var type = asm.GetType("Player");
        if (type == null)
        {
            error = "Classe « Player » introuvable dans le code compilé.";
            alc.Unload();
            return false;
        }
        var decide = type.GetMethod("Decide", new[] { typeof(int), typeof(int), typeof(int), typeof(int), typeof(double), typeof(int) });
        if (decide == null)
        {
            error = "Méthode « int Decide(int,int,int,int,double,int) » introuvable sur Player.";
            alc.Unload();
            return false;
        }

        strategy = new UserStrategy(meta, type, decide, alc);
        return true;
    }

    /// <summary>Vérifie la validité d'un code sans le garder compilé (prévisualisation).</summary>
    public static bool ValidateOnly(string code, out string error)
    {
        error = "";
        var lowered = code ?? "";
        foreach (var f in Forbidden)
            if (lowered.IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                error = $"Code interdit détecté : « {f} ».";
                return false;
            }
        if (!lowered.Contains("class Player")) { error = "Classe « Player » manquante."; return false; }
        return true;
    }
}

/// <summary>Stratégie issue du code utilisateur.  Crée une instance Player fraîche par match.</summary>
internal sealed class UserStrategy : IPdStrategy
{
    private readonly Type _type;
    private readonly MethodInfo _decide;
    private readonly CollectibleAssemblyLoadContext _alc;
    public StratMeta Meta { get; }

    public UserStrategy(StratMeta meta, Type type, MethodInfo decide, CollectibleAssemblyLoadContext alc)
    {
        Meta = meta; _type = type; _decide = decide; _alc = alc;
    }

    public IPdInstance CreateInstance()
    {
        object player;
        try { player = Activator.CreateInstance(_type)!; }
        catch { player = new FallbackDefect(); } // ne devrait pas arriver
        return new UserInstance(player, _decide);
    }

    /// <summary>Décharge l'assemblée compilée (à appeler après le tournoi).</summary>
    public void Unload() => _alc.Unload();
}

internal sealed class UserInstance : IPdInstance
{
    private readonly object _player;
    private readonly MethodInfo _decide;
    public UserInstance(object player, MethodInfo decide) { _player = player; _decide = decide; }
    public int Decide(PdCtx ctx)
    {
        var ret = _decide.Invoke(_player, new object[] { ctx.OpponentLastMove, ctx.CurrentTurn, ctx.MyScore, ctx.OpponentScore, ctx.RandomValue, ctx.MyLastMove });
        return ret is int i ? i : Convert.ToInt32(ret);
    }
}

/// <summary>Stratégie de repli : trahit toujours (en cas d'échec d'instanciation).</summary>
internal sealed class FallbackDefect : IPdInstance
{
    public int Decide(PdCtx ctx) => Pd.Defect;
}

/// <summary>ALC collectible pour décharger les assemblées de stratégies joueurs.</summary>
internal sealed class CollectibleAssemblyLoadContext : AssemblyLoadContext
{
    public CollectibleAssemblyLoadContext() : base(isCollectible: true) { }
    protected override Assembly? Load(AssemblyName name) => null;
}