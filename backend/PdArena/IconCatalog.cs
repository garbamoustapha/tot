// IconCatalog.cs — Icônes prédéfinies proposées aux joueurs pour leur algorithme.
// Le joueur DOIT choisir une icône parmi celles-ci lors de la soumission.
namespace PdArena;

using System.Collections.Generic;

public sealed class AlgoIcon
{
    public string Id { get; init; } = "";
    public string Glyph { get; init; } = "";
    public string Label { get; init; } = "";
}

public static class IconCatalog
{
    public static readonly IReadOnlyList<AlgoIcon> All = new AlgoIcon[]
    {
        new() { Id = "rocket",   Glyph = "🚀", Label = "Fusée" },
        new() { Id = "fox",      Glyph = "🦊", Label = "Renard" },
        new() { Id = "owl",      Glyph = "🦉", Label = "Hibou" },
        new() { Id = "dragon",   Glyph = "🐉", Label = "Dragon" },
        new() { Id = "robot",    Glyph = "🤖", Label = "Robot" },
        new() { Id = "wizard",   Glyph = "🧙", Label = "Mage" },
        new() { Id = "skull",    Glyph = "💀", Label = "Crâne" },
        new() { Id = "crown",    Glyph = "👑", Label = "Couronne" },
        new() { Id = "snake",    Glyph = "🐍", Label = "Serpent" },
        new() { Id = "shark",    Glyph = "🦈", Label = "Requin" },
        new() { Id = "flame",    Glyph = "🔥", Label = "Flamme" },
        new() { Id = "shield",   Glyph = "🛡️", Label = "Bouclier" },
        new() { Id = "bolt",     Glyph = "⚡", Label = "Éclair" },
        new() { Id = "ghost",    Glyph = "👻", Label = "Fantôme" },
        new() { Id = "gem",      Glyph = "💎", Label = "Gemme" },
        new() { Id = "brain",    Glyph = "🧠", Label = "Cerveau" },
        new() { Id = "cat",      Glyph = "🐱", Label = "Chat" },
        new() { Id = "panda",    Glyph = "🐼", Label = "Panda" },
        new() { Id = "unicorn",  Glyph = "🦄", Label = "Licorne" },
        new() { Id = "star",     Glyph = "⭐", Label = "Étoile" },
        new() { Id = "eye",      Glyph = "👁️", Label = "Œil" },
        new() { Id = "alien",    Glyph = "👽", Label = "Alien" },
        new() { Id = "octopus",  Glyph = "🐙", Label = "Pieuvre" },
        new() { Id = "spider",   Glyph = "🕷️", Label = "Araignée" },
        new() { Id = "chess",    Glyph = "♟️", Label = "Pion" },
    };

    public static AlgoIcon? ById(string id)
    {
        foreach (var i in All) if (i.Id == id) return i;
        return null;
    }
}