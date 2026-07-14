// ============================================================================
//  PRISONER'S DILEMMA ARENA — Template de stratégie C#
// ----------------------------------------------------------------------------
//  Signature standardisée (inspirée des tournois d'Axelrod / TourExec) :
//
//      int Decide(
//          int opponentLastMove,  // 0 = Coopérer, 1 = Trahir  (-1 au tour 1)
//          int currentTurn,       // numéro du tour courant (>= 1)
//          int myScore,           // score cumulé du joueur
//          int opponentScore,     // score cumulé de l'adversaire
//          double randomValue,    // aléa ∈ [0,1) pour stratégies stochastiques
//          int myLastMove         // 0 = Coopérer, 1 = Trahir  (-1 au tour 1)
//      ) -> int                   // 0 = Coopérer, 1 = Trahir  (exclusivement)
//
//  Matrice de gain (T,R,P,S) = (5,3,1,0)
//               Adversaire
//               Coopère(0)  Trahit(1)
//  Joueur Coop  R=3 / R=3    S=0 / T=5
//  Joueur Trah  T=5 / S=0    P=1 / P=1
//
//  IMPORTANT :
//   - La classe est instanciée UNE fois par match. Vous pouvez stocker de l'état
//     dans des champs privés : l'instance persiste d'un tour à l'autre.
//   - Le moteur ignore toute valeur autre que 0 ou 1 (coup forfait si violation).
//   - Interdit : accès réseau, système de fichiers, Process, System.Net, etc.
//     (rejeté par validation statique + timeout CPU par tour).
//
//  La classe DOIT s'appeler "Player" et exposer "Decide(...)".  Ne pas renommer.
// ============================================================================

using System;

public class Player
{
    // --- État persistant (réinitialisé à chaque nouveau match) ---------------
    // Astuce : stockez ici l'historique, compteurs, mémoire de l'adversaire…
    private int _cooperationCount = 0;
    private int _defectionCount   = 0;

    public int Decide(
        int opponentLastMove,  // 0 = Coopérer, 1 = Trahir  (-1 au tour 1)
        int currentTurn,       // numéro du tour (>= 1)
        int myScore,           // votre score cumulé
        int opponentScore,     // score cumulé de l'adversaire
        double randomValue,    // aléa ∈ [0,1)
        int myLastMove)        // votre coup précédent (-1 au tour 1)
    {
        // -- 1. Premier tour : pas d'historique. Une stratégie "nice" coopère. --
        if (currentTurn == 1 || opponentLastMove < 0)
        {
            return Cooperate;   // TFT coopère au premier coup
        }

        // -- 2. Mise à jour de l'état (mémoire de l'adversaire) ----------------
        if (opponentLastMove == Cooperate) _cooperationCount++;
        else                                _defectionCount++;

        // -- 3. Stratégie exemple : Tit for Tat (KTitForTatC) ------------------
        //    "Coopère au tour 1, puis copie le dernier coup de l'adversaire."
        return opponentLastMove;   // 0 -> 0, 1 -> 1

        // -- Variantes rapides à expérimenter ----------------------------------
        // Tit for Two Tats (KTF2TC) : trahir uniquement après 2 trahisons consécutives
        //   return (_defectStreak >= 2) ? Defect : Cooperate;  // (tenir _defectStreak)

        // Pavlov (Win-Stay Lose-Shift) : on garde son coup si on a "bien" joué
        //   bool won = (myLastMove == Cooperate && opponentLastMove == Cooperate)
        //           || (myLastMove == Defect   && opponentLastMove == Cooperate);
        //   return won ? myLastMove : (1 - myLastMove);

        // Random :
        //   return (randomValue < 0.5) ? Cooperate : Defect;
    }

    // --- Constantes ----------------------------------------------------------
    private const int Cooperate = 0;
    private const int Defect    = 1;
}