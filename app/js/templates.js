// templates.js — Modèles de code MINIMAUX fournis à l'utilisateur.
// Chaque template contient un commentaire expliquant chaque paramètre et
// ce que la fonction doit retourner. La stratégie affronte TOUS les
// algorithmes (round-robin) ; l'utilisateur n'en choisit aucun.

export const TEMPLATE_PYTHON = `# --- DILEMME DU PRISONNIER ITERE ----------------------------------------
# Votre strategie affronte TOUS les algorithmes (round-robin).
# decide() est appelee a chaque tour. Renvoyez 0 pour COOPERER, 1 pour TRAHIR.
#
# Parametres :
#   opponent_last_move : dernier coup de l'adversaire (0=cooperer, 1=trahir, -1 au tour 1)
#   current_turn       : numero du tour (commence a 1)
#   my_score           : votre score cumule
#   opponent_score     : score cumule de l'adversaire
#   random_value       : nombre aleatoire dans [0, 1) (pour stratgies stochastiques)
#   my_last_move       : votre dernier coup (0/1, -1 au tour 1)
#
# La classe est instanciee une fois par match : son etat (champs) persiste
# d'un tour a l'autre. Bonne chance.

class Player:
    def __init__(self):
        self.history = []  # votre memoire, persistante entre les tours

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        # TODO : ecrivez votre strategie ici.
        if current_turn == 1 or opponent_last_move < 0:
            return 0              # 1er tour : on cooperer par defaut
        return opponent_last_move  # Tit for Tat : copier le dernier coup de l'adversaire
`;

export const TEMPLATE_CSHARP = `// --- DILEMME DU PRISONNIER ITERE ----------------------------------------
// Votre strategie affronte TOUS les algorithmes (round-robin).
// Decide() est appelee a chaque tour. Renvoyez 0 pour COOPERER, 1 pour TRAHIR.
//
// Parametres :
//   opponentLastMove : dernier coup de l'adversaire (0=cooperer, 1=trahir, -1 au tour 1)
//   currentTurn      : numero du tour (commence a 1)
//   myScore          : votre score cumule
//   opponentScore    : score cumule de l'adversaire
//   randomValue      : nombre aleatoire dans [0, 1) (strategies stochastiques)
//   myLastMove       : votre dernier coup (0/1, -1 au tour 1)
//
// La classe est instanciee une fois par match : son etat (champs) persiste
// d'un tour a l'autre. Bonne chance.

using System;

public class Player
{
    private int _last = -1;  // votre memoire, persistante entre les tours

    public int Decide(int opponentLastMove, int currentTurn,
                      int myScore, int opponentScore,
                      double randomValue, int myLastMove)
    {
        // TODO : ecrivez votre strategie ici.
        if (currentTurn == 1 || opponentLastMove < 0)
            return 0;                // 1er tour : on cooperer par defaut
        return opponentLastMove;      // Tit for Tat : copier le dernier coup de l'adversaire
    }
}
`;