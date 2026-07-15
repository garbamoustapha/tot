// Builtins.cs — 19 stratégies de référence, portées de app/js/builtin.js
// (elles-mêmes issues de TourExec / tournois d'Axelrod).  Chaque classe expose
// une fabrique <see cref="IPdStrategy"/> dont l'état persiste par match.
namespace PdArena;

using System;
using System.Collections.Generic;

internal static class BuiltinStrategies
{
    public static readonly IReadOnlyList<IPdStrategy> All = new IPdStrategy[]
    {
        new TitForTat(),
        new TitForTwoTats(),
        new SuspiciousTitForTat(),
        new GenerousTitForTat(),
        new ReverseTitForTat(),
        new Pavlov(),
        new K42R(),
        new Champion(),
        new Tester(),
        new Joss(),
        new GrimTrigger(),
        new Graaskamp(),
        new DawesBatell(),
        new HardMajority(),
        new SoftMajority(),
        new PeriodicCCD(),
        new RandomStrat(),
        new AlwaysCooperate(),
        new AlwaysDefect(),
    };
}

internal static class FirstTurn
{
    public static bool Is(PdCtx ctx) =>
        ctx.CurrentTurn == 1 || ctx.OpponentLastMove < 0;
}

// ============================ Stratégies ====================================

internal sealed class TitForTat : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "tft", Name = "Tit for Tat", Icon = "🪞", Type = "nice",
        Behavior = "Coopère au 1er tour puis copie le dernier coup de l'adversaire. Simple, indulgente et rancunière — la gagnante historique d'Axelrod.",
    };
    public IPdInstance CreateInstance() => new TitForTat();
    public int Decide(PdCtx ctx) => FirstTurn.Is(ctx) ? Pd.Cooperate : ctx.OpponentLastMove;
}

internal sealed class TitForTwoTats : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "tf2t", Name = "Tit for Two Tats", Icon = "🐢", Type = "nice",
        Behavior = "Ne trahit qu'après deux trahisons consécutives de l'adversaire. Plus clémente que TFT, mais exploitable par les stratégies bruitées.",
    };
    private int _prev = Pd.Cooperate;
    public IPdInstance CreateInstance() => new TitForTwoTats();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) return Pd.Cooperate;
        int last = ctx.OpponentLastMove;
        bool two = _prev == Pd.Defect && last == Pd.Defect;
        _prev = last;
        return two ? Pd.Defect : Pd.Cooperate;
    }
}

internal sealed class SuspiciousTitForTat : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "stft", Name = "Suspicious Tit for Tat", Icon = "🤨", Type = "mean",
        Behavior = "TFT méfiante : trahit au 1er tour, puis copie l'adversaire. Prend l'avantage sur les gentilles, mais s'enlise contre elle-même.",
    };
    public IPdInstance CreateInstance() => new SuspiciousTitForTat();
    public int Decide(PdCtx ctx) => FirstTurn.Is(ctx) ? Pd.Defect : ctx.OpponentLastMove;
}

internal sealed class GenerousTitForTat : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "gtft", Name = "Generous Tit for Tat", Icon = "💝", Type = "nice",
        Behavior = "TFT qui pardonne : après une trahison adverse, coopère quand même 10 % du temps. Casse les cycles de vengeance mutuelle.",
    };
    public IPdInstance CreateInstance() => new GenerousTitForTat();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) return Pd.Cooperate;
        if (ctx.OpponentLastMove == Pd.Defect) return ctx.RandomValue < 0.1 ? Pd.Cooperate : Pd.Defect;
        return Pd.Cooperate;
    }
}

internal sealed class ReverseTitForTat : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "rtft", Name = "Reverse Tit for Tat", Icon = "🙃", Type = "mean",
        Behavior = "Fait l'inverse du dernier coup de l'adversaire. Anti-réciprocité pure — performe mal dans un champ de stratégies gentilles.",
    };
    public IPdInstance CreateInstance() => new ReverseTitForTat();
    public int Decide(PdCtx ctx) => FirstTurn.Is(ctx) ? Pd.Cooperate : 1 - ctx.OpponentLastMove;
}

internal sealed class Pavlov : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "pavlov", Name = "Pavlov", Icon = "🔔", Type = "nice",
        Behavior = "Win-Stay Lose-Shift : conserve son coup s'il a bien payé (R ou T), sinon change. Sait revenir à la coopération après une trahison mutuelle.",
    };
    public IPdInstance CreateInstance() => new Pavlov();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx) || ctx.MyLastMove < 0) return Pd.Cooperate;
        int my = ctx.MyLastMove, opp = ctx.OpponentLastMove;
        bool won = (my == Pd.Cooperate && opp == Pd.Cooperate) || (my == Pd.Defect && opp == Pd.Cooperate);
        return won ? my : 1 - my;
    }
}

internal sealed class K42R : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "k42r", Name = "k42r (Borufsen)", Icon = "🛡️", Type = "nice",
        Behavior = "TFT robuste de Borufsen : tous les 25 tours, détecte les adversaires aléatoires ou trop défectifs et les punit 25 tours.",
    };
    private int _oppDefect, _oppCoop, _punishLeft, _threeMutualDef;
    public IPdInstance CreateInstance() => new K42R();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx))
        {
            _oppDefect = 0; _oppCoop = 0; _punishLeft = 0; _threeMutualDef = 0;
            return Pd.Cooperate;
        }
        if (ctx.OpponentLastMove == Pd.Defect) _oppDefect++; else _oppCoop++;

        int move;
        if (_punishLeft > 0)
        {
            move = Pd.Defect;
            _punishLeft--;
        }
        else if (ctx.MyLastMove == Pd.Defect && ctx.OpponentLastMove == Pd.Defect)
        {
            _threeMutualDef++;
            if (_threeMutualDef >= 3) { move = Pd.Cooperate; _threeMutualDef = 0; }
            else move = ctx.OpponentLastMove;
        }
        else
        {
            _threeMutualDef = 0;
            move = ctx.OpponentLastMove;
        }

        if (ctx.CurrentTurn > 1 && (ctx.CurrentTurn - 1) % 25 == 0)
        {
            double rate = (double)_oppDefect / (_oppDefect + _oppCoop);
            if (rate > 0.7 || (_oppCoop < 3 && ctx.CurrentTurn >= 25))
            {
                _punishLeft = 25;
                _threeMutualDef = 0;
                move = Pd.Defect;
            }
            _oppDefect = 0; _oppCoop = 0;
        }
        return move;
    }
}

internal sealed class Champion : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "champion", Name = "Champion Axelrod", Icon = "🏆", Type = "nice",
        Behavior = "TFT avec une sonde : trahit au tour 7 puis se réexcuse au tour 8, pour sortir des cycles de trahison mutuelle.",
    };
    private bool _probed;
    public IPdInstance CreateInstance() => new Champion();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _probed = false; return Pd.Cooperate; }
        if (!_probed && ctx.CurrentTurn == 7) { _probed = true; return Pd.Defect; }
        if (_probed && ctx.CurrentTurn == 8) return Pd.Cooperate;
        return ctx.OpponentLastMove;
    }
}

internal sealed class Tester : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "tester", Name = "Tester", Icon = "🧪", Type = "mean",
        Behavior = "Trahit au 1er tour pour sonder. Si l'adversaire riposte, s'excuse puis joue TFT ; sinon l'exploite en alternant.",
    };
    private bool _retaliated, _apologize;
    public IPdInstance CreateInstance() => new Tester();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _retaliated = false; _apologize = false; return Pd.Defect; }
        if (!_retaliated && ctx.OpponentLastMove == Pd.Defect) { _retaliated = true; _apologize = true; }
        if (_retaliated)
        {
            if (_apologize) { _apologize = false; return Pd.Cooperate; }
            return ctx.OpponentLastMove;
        }
        return ctx.CurrentTurn % 2 == 0 ? Pd.Defect : Pd.Cooperate;
    }
}

internal sealed class Joss : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "joss", Name = "Joss", Icon = "🎯", Type = "noisy",
        Behavior = "TFT bruitée : comme TFT, mais trahit au hasard 10 % du temps où elle aurait coopéré. Provoque des cascades de trahison avec TFT.",
    };
    public IPdInstance CreateInstance() => new Joss();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) return Pd.Cooperate;
        if (ctx.OpponentLastMove == Pd.Defect) return Pd.Defect;
        return ctx.RandomValue < 0.1 ? Pd.Defect : Pd.Cooperate;
    }
}

internal sealed class GrimTrigger : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "grim", Name = "Grim Trigger", Icon = "☠️", Type = "nice",
        Behavior = "Gâchette : coopère jusqu'à la moindre trahison adverse, puis trahit à jamais. Intransigeante — une seule erreur la condamne.",
    };
    private bool _triggered;
    public IPdInstance CreateInstance() => new GrimTrigger();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _triggered = false; return Pd.Cooperate; }
        if (ctx.OpponentLastMove == Pd.Defect) _triggered = true;
        return _triggered ? Pd.Defect : Pd.Cooperate;
    }
}

internal sealed class Graaskamp : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "graaskamp", Name = "Graaskamp (k60r)", Icon = "📊", Type = "nice",
        Behavior = "TFT avec contrôles : aux tours 11, 21, 31, 41, 51, 101, abandonne et trahit toujours si son score cumulé est sous un seuil calibré.",
    };
    private static readonly int[][] _checks =
    {
        new[] { 11, 23 }, new[] { 21, 53 }, new[] { 31, 83 },
        new[] { 41, 113 }, new[] { 51, 143 }, new[] { 101, 293 },
    };
    private bool _gaveUp;
    public IPdInstance CreateInstance() => new Graaskamp();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _gaveUp = false; return Pd.Cooperate; }
        if (_gaveUp) return Pd.Defect;
        foreach (var c in _checks)
            if (ctx.CurrentTurn == c[0] && ctx.MyScore < c[1]) { _gaveUp = true; return Pd.Defect; }
        return ctx.OpponentLastMove;
    }
}

internal sealed class DawesBatell : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "dawes", Name = "Dawes & Batell (k80r)", Icon = "⚖️", Type = "nice",
        Behavior = "Coopère, mais si l'adversaire trahit trop (seuil pondéré), bascule en trahison permanente. Clémente puis impitoyable.",
    };
    private bool _mode;
    private int _inod;
    public IPdInstance CreateInstance() => new DawesBatell();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _mode = false; _inod = 0; return Pd.Cooperate; }
        if (_mode) return Pd.Defect;
        if (ctx.OpponentLastMove == Pd.Defect)
        {
            _inod++;
            int inoc = ctx.CurrentTurn - _inod;
            double test = Math.Pow(1.6667, _inod) * Math.Pow(0.882, inoc);
            if (test >= 5) { _mode = true; return Pd.Defect; }
        }
        return Pd.Cooperate;
    }
}

internal sealed class HardMajority : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "hardmaj", Name = "Hard Majority (Grisell)", Icon = "🗳️", Type = "nice",
        Behavior = "Trahit dès que l'adversaire a trahi dans au moins la moitié des tours. Décision à la majorité des actes passés.",
    };
    private int _def, _n;
    public IPdInstance CreateInstance() => new HardMajority();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _def = 0; _n = 0; return Pd.Cooperate; }
        _n++;
        if (ctx.OpponentLastMove == Pd.Defect) _def++;
        return (double)_def / _n >= 0.5 ? Pd.Defect : Pd.Cooperate;
    }
}

internal sealed class SoftMajority : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "softmaj", Name = "Soft Majority", Icon = "🌿", Type = "nice",
        Behavior = "Coopère sauf si l'adversaire a trahi strictement plus qu'il n'a coopéré. Version indulgente de Hard Majority.",
    };
    private int _def, _coop;
    public IPdInstance CreateInstance() => new SoftMajority();
    public int Decide(PdCtx ctx)
    {
        if (FirstTurn.Is(ctx)) { _def = 0; _coop = 0; return Pd.Cooperate; }
        if (ctx.OpponentLastMove == Pd.Defect) _def++; else _coop++;
        return _def > _coop ? Pd.Defect : Pd.Cooperate;
    }
}

internal sealed class PeriodicCCD : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "ccd", Name = "Periodic C·C·D", Icon = "🔁", Type = "mean",
        Behavior = "Joue périodiquement Coopérer·Coopérer·Trahir. Trahit sans provocation — déclenche des ripostes.",
    };
    public IPdInstance CreateInstance() => new PeriodicCCD();
    public int Decide(PdCtx ctx) => (ctx.CurrentTurn - 1) % 3 == 2 ? Pd.Defect : Pd.Cooperate;
}

internal sealed class RandomStrat : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "random", Name = "Random", Icon = "🎲", Type = "noisy",
        Behavior = "Coopère ou trahit au hasard (50/50). Aucune mémoire, aucun objectif — utile comme étalon stochastique.",
    };
    public IPdInstance CreateInstance() => new RandomStrat();
    public int Decide(PdCtx ctx) => ctx.RandomValue < 0.5 ? Pd.Cooperate : Pd.Defect;
}

internal sealed class AlwaysCooperate : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "allc", Name = "Always Cooperate", Icon = "🤍", Type = "nice",
        Behavior = "Coopère toujours, quoi qu'il arrive. Inoffensive — la proie idéale des traîtres.",
    };
    public IPdInstance CreateInstance() => new AlwaysCooperate();
    public int Decide(PdCtx ctx) => Pd.Cooperate;
}

internal sealed class AlwaysDefect : IPdInstance, IPdStrategy
{
    public StratMeta Meta { get; } = new()
    {
        Id = "alld", Name = "Always Defect", Icon = "💀", Type = "mean",
        Behavior = "Trahit toujours. Gagne en duel unique mais s'effondre en tournoi à cause des trahisons mutuelles.",
    };
    public IPdInstance CreateInstance() => new AlwaysDefect();
    public int Decide(PdCtx ctx) => Pd.Defect;
}