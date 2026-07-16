// Program.cs — Point d'entrée de l'arène en ligne PD Arena (ASP.NET Core 9).
// --------------------------------------------------------------------------
//  • Sert le frontend statique (../app) à la racine  →  / et /arena.html
//  • SignalR hub temps réel                          →  /arenaHub
//  • REST API de soumission / classement / icônes    →  /api/*
//  • Service hébergé : tournoi horaire + compte à rebours
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using PdArena;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(opts =>
{
    opts.AddDefaultPolicy(p => p
        .SetIsOriginAllowed(_ => true)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()); // SignalR exige AllowCredentials avec origine autorisée
});

builder.Services.AddSignalR();
builder.Services.AddSingleton<ArenaState>();

// Persistance : SQL Server (MonsterASP databaseasp.net).  La chaîne de connexion
// vient de ConnectionStrings:Default (appsettings.json) ou de la variable
// d'environnement PDARENA_DB.  Aucun stockage fichier.
var connStr = builder.Configuration.GetConnectionString("Default")
    ?? Environment.GetEnvironmentVariable("PDARENA_DB")
    ?? throw new InvalidOperationException(
        "Chaîne de connexion SQL manquante : définir ConnectionStrings:Default ou PDARENA_DB.");
builder.Services.AddSingleton<StrategyStore>(_ => new StrategyStore(connStr));
builder.Services.AddHostedService<TournamentService>();

var app = builder.Build();
app.UseCors();

// --- Fichiers statiques : sert le frontend SPA ---
// En développement    : ../../app          (D:\tot\backend\PdArena → D:\tot\app)
// En production (IIS)  : ./wwwroot          (le frontend est copié dans wwwroot au publish)
var appDir = new[]
    {
        Path.Combine(builder.Environment.ContentRootPath, "..", "..", "app"),
        Path.Combine(builder.Environment.ContentRootPath, "wwwroot"),
    }
    .Select(Path.GetFullPath)
    .FirstOrDefault(Directory.Exists);
if (appDir is not null && Directory.Exists(appDir))
{
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = new PhysicalFileProvider(appDir) });
    // En développement, on désactive le cache navigateur (no-cache = toujours
    // revalider via l'ETag) pour que les éditions de arena.js/css/html soient
    // visibles dès le rafraîchissement, sans cache heuristique périmé.
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(appDir),
        OnPrepareResponse = ctx =>
        {
            if (builder.Environment.IsDevelopment())
                ctx.Context.Response.Headers["Cache-Control"] = "no-cache";
        },
    });
}

// ============================ REST API ======================================

app.MapGet("/api/icons", () => Results.Ok(IconCatalog.All));

app.MapGet("/api/strategies", (StrategyStore store) => Results.Ok(store.ListPublic()));

app.MapGet("/api/leaderboard", (ArenaState state) => Results.Ok(new
{
    leaderboard = state.Snapshot(),
    nextTournamentAt = state.NextTournamentAt.ToString("o"),
    remainingSeconds = state.RemainingSeconds(),
    status = state.Status,
}));

app.MapGet("/api/duels", (ArenaState state) => Results.Ok(new
{
    duels = state.DuelsSnapshot(),
    tournamentId = state.LastTournamentId,
}));

app.MapGet("/api/status", (ArenaState state) => Results.Ok(new
{
    nextTournamentAt = state.NextTournamentAt.ToString("o"),
    remainingSeconds = state.RemainingSeconds(),
    status = state.Status,
    progress = new { done = state.Progress.done, total = state.Progress.total },
    strategiesCount = app.Services.GetRequiredService<StrategyStore>().Count,
}));

// --- Soumission d'une stratégie dans l'arène ---
app.MapPost("/api/submit", async (SubmissionDto dto, StrategyStore store, IHubContext<ArenaHub> hub, ArenaState state) =>
{
    // 1) Validation des champs obligatoires : nom du joueur, nom de l'algo, icône.
    var playerName = (dto?.PlayerName ?? "").Trim();
    var algoName = (dto?.AlgoName ?? "").Trim();
    var iconId = (dto?.IconId ?? "").Trim();
    var code = dto?.Code ?? "";

    if (string.IsNullOrEmpty(playerName)) return Results.BadRequest(new { error = "Le nom du joueur est requis." });
    if (string.IsNullOrEmpty(algoName)) return Results.BadRequest(new { error = "Le nom de l'algorithme est requis." });
    if (string.IsNullOrEmpty(iconId) || IconCatalog.ById(iconId) is null)
        return Results.BadRequest(new { error = "Vous devez choisir une icône pour votre algorithme." });
    if (string.IsNullOrWhiteSpace(code)) return Results.BadRequest(new { error = "Le code de la stratégie est vide." });

    // 2) Validation + compilation de contrôle (sans garder l'instance).
    if (!UserStrategyCompiler.TryCompile(code, new StratMeta { Id = "preview", Name = algoName },
        out _, out var compileError))
    {
        return Results.BadRequest(new { error = compileError });
    }

    // 3) Enregistrement (remplace la stratégie précédente du même joueur).
    var stored = store.Upsert(playerName, algoName, iconId, code);
    var icon = IconCatalog.ById(iconId)!;

    // 4) Notification temps réel : un nouveau joueur entre dans l'arène.
    await hub.Clients.Group(ArenaHub.Group).SendAsync("ReceiveSubmission",
        stored.PlayerName, stored.AlgoName, icon.Glyph, store.Count);

    return Results.Ok(new
    {
        ok = true,
        id = stored.Id,
        playerName = stored.PlayerName,
        algoName = stored.AlgoName,
        iconGlyph = icon.Glyph,
        totalStrategies = store.Count,
        nextTournamentAt = state.NextTournamentAt.ToString("o"),
        remainingSeconds = state.RemainingSeconds(),
        message = "Stratégie enregistrée ! Elle affrontera tous les algorithmes au prochain tournoi.",
    });
});

// --- Déclenche un tournoi immédiatement (démo / bouton « Lancer maintenant ») ---
app.MapPost("/api/tournament/trigger", (ArenaState state) =>
{
    state.NextTournamentAt = DateTime.UtcNow;
    return Results.Ok(new { ok = true, message = "Tournoi déclenché." });
});

// --- Rejoue un match entre deux stratégies (par id) et renvoie la séquence des
// coups tour par tour.  Le serveur possède toutes les stratégies compilées
// (joueurs + 19 builtins), donc TOUT duel du classement est animable côté client,
// y compris les stratégies des autres joueurs (le code n'est pas exposé).
app.MapPost("/api/replay", (ReplayDto dto, StrategyStore store) =>
{
    var byId = new Dictionary<string, IPdStrategy>();
    foreach (var s in store.BuildLiveStrategies(out _)) byId[s.Meta.Id] = s;
    foreach (var s in BuiltinStrategies.All) byId[s.Meta.Id] = s;

    if (!byId.TryGetValue(dto?.AId ?? "", out var a) || !byId.TryGetValue(dto?.BId ?? "", out var b))
        return Results.BadRequest(new { error = "Stratégie introuvable (id inconnu)." });

    int length = dto!.Length > 0 ? dto.Length : Pd.Lengths[1];
    int seed = (dto.Seed > 0 ? dto.Seed : 1);

    var movesA = new List<int>(length);
    var movesB = new List<int>(length);
    var res = Engine.PlayMatch(a, b, length, new Random(seed), onTurn: (_, ma, mb) =>
    {
        movesA.Add(ma); movesB.Add(mb);
    });

    return Results.Ok(new
    {
        movesA, movesB,
        scoreA = res.ScoreA, scoreB = res.ScoreB,
        length, winner = res.Winner,
        faultsA = res.FaultsA, faultsB = res.FaultsB,
        aId = a.Meta.Id, bId = b.Meta.Id,
        nameA = a.Meta.Name, nameB = b.Meta.Name,
        iconA = a.Meta.Icon, iconB = b.Meta.Icon,
        isUserA = a.Meta.IsUser, isUserB = b.Meta.IsUser,
    });
});

// --- Diagnostic base de données (temporaire) : renvoie l'état de la connexion SQL. ---
app.MapGet("/api/dbcheck", (StrategyStore store) =>
{
    var err = store.Diagnose();
    return Results.Ok(new { ok = err is null, error = err });
});

app.MapHub<ArenaHub>("/arenaHub");

app.Run();