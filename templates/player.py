# ============================================================================
#  PRISONER'S DILEMMA ARENA — Template de stratégie Python
# ----------------------------------------------------------------------------
#  Signature standardisée (inspirée des tournois d'Axelrod / TourExec) :
#
#      def decide(
#          opponent_last_move: int,   # 0 = Coopérer, 1 = Trahir  (None au t1)
#          current_turn: int,         # numéro du tour courant (>= 1)
#          my_score: int,             # score cumulé du joueur
#          opponent_score: int,       # score cumulé de l'adversaire
#          random_value: float,       # aléa ∈ [0,1) pour stratégies stochastiques
#          my_last_move: int          # 0 = Coopérer, 1 = Trahir  (None au t1)
#      ) -> int                       # 0 = Coopérer, 1 = Trahir  (exclusivement)
#
#  Matrice de gain (T,R,P,S) = (5,3,1,0)
#               Adversaire
#               Coopère(0)  Trahit(1)
#  Joueur Coop  R=3 / R=3    S=0 / T=5
#  Joueur Trah  T=5 / S=0    P=1 / P=1
#
#  IMPORTANT :
#   - La classe est instanciée UNE fois par match. L'état stocké dans __init__
#     persiste d'un tour à l'autre (mémoire de l'historique, compteurs…).
#   - Le moteur ignore toute valeur autre que 0 ou 1 (coup forfait si violation).
#   - Interdit : import de socket, subprocess, os.system, ctypes, requests,
#     accès réseau/FS… (rejeté par validation statique + timeout CPU par tour).
#
#  La classe DOIT s'appeler "Player" et exposer "decide(...)". Ne pas renommer.
# ============================================================================

COOPERATE = 0
DEFECT    = 1


class Player:
    """Stratégie joueur. Instance unique par match (état persistant)."""

    def __init__(self):
        # --- État persistant (réinitialisé à chaque nouveau match) -----------
        # Astuce : stockez ici l'historique, compteurs, mémoire de l'adversaire…
        self.cooperation_count = 0   # nombre de fois où l'adversaire a coopéré
        self.defection_count   = 0   # nombre de fois où l'adversaire a trahi
        self.opponent_history = []   # suite complète des coups de l'adversaire

    def decide(
        self,
        opponent_last_move,   # 0 = Coopérer, 1 = Trahir  (None au tour 1)
        current_turn,         # numéro du tour (>= 1)
        my_score,             # votre score cumulé
        opponent_score,       # score cumulé de l'adversaire
        random_value,         # aléa ∈ [0,1)
        my_last_move,         # votre coup précédent (None au tour 1)
    ):
        # -- 1. Premier tour : pas d'historique. Une stratégie "nice" coopère. -
        if current_turn == 1 or opponent_last_move is None:
            return COOPERATE   # TFT coopère au premier coup

        # -- 2. Mise à jour de l'état (mémoire de l'adversaire) ----------------
        self.opponent_history.append(opponent_last_move)
        if opponent_last_move == COOPERATE:
            self.cooperation_count += 1
        else:
            self.defection_count += 1

        # -- 3. Stratégie exemple : Tit for Tat (KTitForTatC) ------------------
        #    "Coopère au tour 1, puis copie le dernier coup de l'adversaire."
        return opponent_last_move   # COOPERATE -> 0, DEFECT -> 1

        # -- Variantes rapides à expérimenter ----------------------------------
        # Tit for Two Tats (KTF2TC) : trahir après 2 trahisons consécutives
        #   last_two = self.opponent_history[-2:]
        #   return DEFECT if (len(last_two) == 2 and last_two == [DEFECT, DEFECT]) else COOPERATE

        # Pavlov (Win-Stay Lose-Shift) : garder son coup si "gagné", sinon changer
        #   won = (my_last_move == COOPERATE and opponent_last_move == COOPERATE) \
        #       or (my_last_move == DEFECT and opponent_last_move == COOPERATE)
        #   return my_last_move if won else (1 - my_last_move)

        # Random :
        #   return COOPERATE if random_value < 0.5 else DEFECT