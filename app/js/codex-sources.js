// codex-sources.js — Sources affichées dans la vue « Algorithmes ».
// --------------------------------------------------------------------------
// Pour chaque stratégie de référence (id = meta.id de builtin.js) on fournit :
//   - author       : auteur / origine historique de la stratégie
//   - fortranFile  : nom du fichier original dans TourExec (ou null)
//   - py           : portage Python idiomatique (classe Player, même signature
//                    que l'éditeur du joueur)
//   - fortran      : source Fortran ORIGINALE de TourExec, verbatim (ou null
//                    pour les classiques d'Axelrod sans fichier dédié)
//
// Les 9 stratégies portées de TourExec (TFT, TF2T, Pavlov, Random, Hard
// Majority/k31r, Borufsen/k42r, Graaskamp/k60r, Champion/k61r, Dawes/k80r)
// ont leur Fortran d'origine. Les autres sont des classiques d'Axelrod
// reconstruites d'après leur définition — pas de fichier Fortran unique.

export const CODEX_SOURCES = {
  // ------------------------------------------------------------- Tit for Tat
  tft: {
    author: 'Anatol Rapoport (gagnante des deux tournois d\'Axelrod)',
    fortranFile: 'KTitForTatC.f',
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            return 0                  # coopère au premier tour
        return opponent_last_move     # puis copie le dernier coup adverse`,
    fortran: `      Function KTitForTatC(J,M,K,L,R)     ! TFT, Row Rule
      KTitForTatC = J
      Return
      End     ! TFT Col Rule`,
  },

  // --------------------------------------------------------- Tit for Two Tats
  tf2t: {
    author: 'Anatol Rapoport (codée par Axelrod)',
    fortranFile: 'KTF2TC.f',
    py: `class Player:
    def __init__(self):
        self.prev = 0                 # avant-dernier coup de l'adversaire

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.prev = 0
            return 0
        two_defects = self.prev == 1 and opponent_last_move == 1
        self.prev = opponent_last_move
        return 1 if two_defects else 0   # ne trahit qu'après 2 trahisons`,
    fortran: `      Function KTF2TC(J,M,K,L,R)          !  Tit for Two Tats, Col rule
      if(m .eq. 1)  jold = 0
      ktf2tc = 0
      if ((jold .EQ. 1) .and. (j .eq. 1)) ktf2tc = 1
      jold = j
      Return
      End     ! TF2T Col Rule`,
  },

  // --------------------------------------------------- Suspicious Tit for Tat
  stft: {
    author: 'Variante classique d\'Axelrod',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            return 1                  # trahit au premier tour (méfiance)
        return opponent_last_move     # puis Tit for Tat`,
    fortran: null,
  },

  // ----------------------------------------------------- Generous Tit for Tat
  gtft: {
    author: 'Nowak & Sigmund',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            return 0
        if opponent_last_move == 1:
            return 0 if random_value < 0.1 else 1   # pardonne 10% des trahisons
        return 0`,
    fortran: null,
  },

  // ------------------------------------------------------- Reverse Tit for Tat
  rtft: {
    author: 'Variante classique d\'Axelrod',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            return 0
        return 1 - opponent_last_move   # fait l'inverse du dernier coup adverse`,
    fortran: null,
  },

  // ----------------------------------------------------------------- Pavlov
  pavlov: {
    author: 'Kraines & Kraines / Nowak (codée par Axelrod, 1993)',
    fortranFile: 'KPavlovC.f',
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0 or my_last_move < 0:
            return 0
        # Win-Stay / Lose-Shift : garde son coup s'il a bien payé (adv. a coopéré)
        won = opponent_last_move == 0
        return my_last_move if won else 1 - my_last_move`,
    fortran: `      Function KPavlovC(J,M,K,L,R,JB)     ! Pavlov, JB is own (Col) previous move
c   coded by Ax 7/22-3/93. Assumes C on first move.
      KPavlovC = 1
      if (J .eq. JB) KPavlovC = 0 ! coop iff other's previous choice= own previous ch
      Return
      end`,
  },

  // ------------------------------------------------------------ k42r Borufsen
  k42r: {
    author: 'Otto Borufsen (2e tournoi d\'Axelrod, rang 3)',
    fortranFile: 'k42r.f',
    py: `class Player:
    def __init__(self):
        self.reset()

    def reset(self):
        self.opp_defect = 0
        self.opp_coop = 0
        self.punishing = False
        self.punish_left = 0
        self.three_mutual_def = 0

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.reset()
            return 0

        if opponent_last_move == 1:
            self.opp_defect += 1
        else:
            self.opp_coop += 1

        if self.punishing:
            move = 1
            self.punish_left -= 1
            if self.punish_left <= 0:
                self.punishing = False
        elif my_last_move == 1 and opponent_last_move == 1:
            self.three_mutual_def += 1
            if self.three_mutual_def >= 3:      # 3 trahisons mutuelles -> apaise
                move = 0
                self.three_mutual_def = 0
            else:
                move = opponent_last_move        # sinon Tit for Tat
        else:
            self.three_mutual_def = 0
            move = opponent_last_move            # Tit for Tat

        # Tous les 25 tours : l'adversaire est-il aléatoire / défectif ?
        if current_turn > 1 and (current_turn - 1) % 25 == 0:
            total = self.opp_defect + self.opp_coop
            defect_rate = self.opp_defect / total if total else 0
            if defect_rate > 0.7 or (self.opp_coop < 3 and current_turn >= 25):
                self.punishing = True            # punit 25 tours
                self.punish_left = 25
                self.three_mutual_def = 0
                move = 1
            self.opp_defect = 0
            self.opp_coop = 0

        return move`,
    fortran: `       FUNCTION K42R(JPICK,MOVEN,ISCORE,JSCORE,RANDOM, JA)
C BY OTTO BORUFSEN
C TYPED FROM FORTRAN BY AX, 1/25/79
      DIMENSION MHIST(2,2)
      k42r=ja    ! Added 7/27/93 to report own old value
C INITIALIZE FIRST MOVE
      IF(MOVEN.NE.1)GOTO 20
         L3MOV=0
         L3ECH=0
         IDEF=0
         ICOOP=0
         IPICK=0
         DO 10 I=1,2
         DO 10 J=1,2
10       MHIST(I,J)=0
         GO TO 500
20    IF(MOVEN.EQ.2)GOTO 25
C UPDATE MOVE HISTORY
      MHIST(I2PCK+1,JPICK+1)=MHIST(I2PCK+1,JPICK+1)+1
25    IF(IDEF.EQ.0)GOTO 30
C OPPONENT HAS BEEN PROVED "RANDOM" OR
C "DEFECTIVE",I DEFECT FOR 25 MOVES
      K42R=1
      GO TO 100
30    IF(IPICK.EQ.0.OR.JPICK.EQ.0)GOTO 40
C MUTUAL DEFECTIONS ON LAST MOVE.
      L3MOV=L3MOV+1
      IF(L3MOV.LT.3)GOTO 50
C MUTUAL DEFECTION ON LAST THREE MOVES.
C I COOPERATE ONCE ON NEXT MOVE.
      K42R=0
      L3MOV=0
      L3ECH=0
      GOTO 100
C ONE (OR BOTH) COOPERATED ON LAST MOVE.
40    L3MOV=0
      IF(IPICK.EQ.JPICK)GOTO 45
      IF(JPICK.NE.I2PCK.OR.IPICK.NE.J2PCK)GOTO 45
C ECHO-EFFECT ON LAST MOVE.
      L3ECH=L3ECH+1
      IF(L3ECH.LT.3)GOTO 50
C ECHO-EFFECT ON LAST THREE MOVES.
      L3ECH=0
      L3MOV=0
      ICOOP=1
      GOTO 50
45    L3ECH=0
C PLAY 'TIT FOR TAT' AS MAIN RULE.
50    K42R=JPICK
100   IF(MOD(MOVEN-2,25).NE.0.OR.MOVEN.EQ.2)GOTO 650
C ON EVERY 25 MOVES: RANDOM / DEFECTIVE?
      IDEF=0
      JNCOP=MHIST(1,1)+MHIST(2,1)
      IF(JNCOP.GT.17)GOTO 155
      IF(JNCOP.LT.8)GOTO 130
      IF(100*MHIST(1,1)/JNCOP.LT.70)IDEF=1
      GOTO 155
130   IF(JNCOP.LT.3)IDEF=1
155   DO 160 I=1,2
      DO 160 J=1,2
160   MHIST(I,J)=0
      IF(IDEF.EQ.0)GOTO 650
      ICOOP=0
      L3MOV=0
      L3ECH=0
      GOTO 600
500   K42R=0
      GOTO 650
600   K42R=1
650   IF(ICOOP.EQ.0.OR.K42R.EQ.0)GOTO 660
         ICOOP=0
         K42R=0
660   I2PCK=IPICK
      J2PCK=JPICK
      IPICK=K42R
      RETURN
      END`,
  },

  // ------------------------------------------------------------ Champion k61r
  champion: {
    author: 'Danny C. Champion',
    fortranFile: 'k61r.f',
    py: `class Player:
    def __init__(self):
        self.probed = False

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.probed = False
            return 0
        if not self.probed and current_turn == 7:
            self.probed = True
            return 1                  # sonde une trahison
        if self.probed and current_turn == 8:
            return 0                  # puis s'excuse
        return opponent_last_move     # Tit for Tat le reste du temps`,
    fortran: `      FUNCTION K61R(ISPICK,ITURN,K,L,R, JA)
C BY DANNY C. CHAMPION
C TYPED BY JM 3/27/79
      k61r=ja    ! Added 7/27/93 to report own old value
      IF (ITURN .EQ. 1) ICOOP = 0  ! Added 10/8/2017 to fix bug for multiple runs
      IF (ITURN .EQ. 1) K61R = 0
      IF (ISPICK .EQ. 0) ICOOP = ICOOP + 1
      IF (ITURN .LE. 10) RETURN
      K61R = ISPICK
      IF (ITURN .LE. 25) RETURN
      K61R = 0
      COPRAT = FLOAT(ICOOP) / FLOAT(ITURN)
      IF (ISPICK .EQ. 1 .AND. COPRAT .LT. .6 .AND. R .GT. COPRAT)
     +K61R = 1
      RETURN
      END`,
  },

  // ----------------------------------------------------------------- Tester
  tester: {
    author: 'Classique d\'Axelrod (« Tester »)',
    fortranFile: null,
    py: `class Player:
    def __init__(self):
        self.retaliated = False
        self.apologize = False

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.retaliated = False
            self.apologize = False
            return 1                  # sonde en trahissant
        if not self.retaliated and opponent_last_move == 1:
            self.retaliated = True
            self.apologize = True
        if self.retaliated:
            if self.apologize:
                self.apologize = False
                return 0              # s'excuse une fois
            return opponent_last_move # puis Tit for Tat
        return 1 if current_turn % 2 == 0 else 0   # sinon exploite en alternant`,
    fortran: null,
  },

  // -------------------------------------------------------------------- Joss
  joss: {
    author: 'Johann Joss (1er tournoi d\'Axelrod)',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            return 0
        if opponent_last_move == 1:
            return 1                  # riposte comme Tit for Tat
        return 1 if random_value < 0.1 else 0   # mais trahit 10% sur coopération`,
    fortran: null,
  },

  // ------------------------------------------------------------- Grim Trigger
  grim: {
    author: 'Friedman (« Grim » / gâchette)',
    fortranFile: null,
    py: `class Player:
    def __init__(self):
        self.triggered = False

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.triggered = False
            return 0
        if opponent_last_move == 1:
            self.triggered = True     # une seule trahison suffit
        return 1 if self.triggered else 0   # puis trahit à jamais`,
    fortran: null,
  },

  // ------------------------------------------------------------ Graaskamp k60r
  graaskamp: {
    author: 'Jim Graaskamp & Ken Katzen',
    fortranFile: 'k60r.f',
    py: `class Player:
    def __init__(self):
        self.gave_up = False

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.gave_up = False
            return 0
        if self.gave_up:
            return 1
        # Points de contrôle : abandonne si le score cumulé est sous le seuil
        checkpoints = [(11, 23), (21, 53), (31, 83),
                       (41, 113), (51, 143), (101, 293)]
        for turn, threshold in checkpoints:
            if current_turn == turn and my_score < threshold:
                self.gave_up = True
                return 1
        return opponent_last_move     # sinon Tit for Tat`,
    fortran: `      FUNCTION K60R(J,M,K,L,R, JA)
C BY JIM GRAASKAMP AND KEN KATZEN
C FROM CARDS BY JM 2/22/79
      k60r=ja    ! Added 7/27/93 to report own old value
      IF (M-1)1,1,2
1     ID=0
      K60R=0
      GO TO 50
2     IF (ID-1)3,4,4
3     K60R=J
      IF (M-11)50,5,6
5     IF (K-23)51,50,50
6     IF (M-21)50,7,8
7     IF(K-53)51,50,50
8     IF (M-31)50,9,10
9     IF (K-83)51,50,50
10    IF (M-41)50,11,12
11    IF (K-113)51,50,50
12    IF (M-51)50,13,14
13    IF (K-143)51,50,50
14    IF (M-101)50,15,50
15    IF (K-293)51,50,50
51    ID=1
4     K60R=1
50    RETURN
      END`,
  },

  // --------------------------------------------------- Dawes & Batell k80r
  dawes: {
    author: 'Robyn M. Dawes & Mark Batell',
    fortranFile: 'k80r.f',
    py: `class Player:
    def __init__(self):
        self.mode = False   # False = coopère, True = trahison permanente
        self.inod = 0       # nombre de trahisons adverses observées

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.mode = False
            self.inod = 0
            return 0
        if self.mode:
            return 1
        if opponent_last_move == 1:
            self.inod += 1
            inoc = current_turn - self.inod            # tours de coopération
            test = (1.6667 ** self.inod) * (0.882 ** inoc)
            if test >= 5:                              # seuil de bascule
                self.mode = True
                return 1
        return 0`,
    fortran: `      FUNCTION K80R(J,M,K,L,R, JA)
C BY ROBYN M DAWES AND MARK BATELL
C TYPED BY JM 3/22/79
      k80r=ja    ! Added 7/27/93 to report own old value
      IF (M .EQ. 1) GOTO 10
      IF (MODE .EQ. 1) GOTO 35
      IF (J .EQ. 1) GOTO 20
      GOTO 15
5     INOC = M - INOD
      T1 = 1.6667 ** INOD
      T2 = 0.882 ** INOC
      TEST = T1 * T2
      IF (TEST .GE. 5.) GOTO 30
      GOTO 15
10    MODE = 0
      INOD = 0
      INOC = 0
      T1 = 0
      T2 = 0.
      TEST = 0.
15    K80R = 0
      GOTO 40
20    INOD = INOD + 1
      GOTO 5
30    MODE = 1
35    K80R = 1
40    RETURN
      END`,
  },

  // ------------------------------------------------------- Hard Majority k31r
  hardmaj: {
    author: 'Paula Gail Grisell',
    fortranFile: 'k31r.f',
    py: `class Player:
    def __init__(self):
        self.defects = 0
        self.rounds = 0

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.defects = 0
            self.rounds = 0
            return 0
        self.rounds += 1
        if opponent_last_move == 1:
            self.defects += 1
        # trahit si l'adversaire a trahi dans au moins la moitié des tours
        return 1 if self.defects / self.rounds >= 0.5 else 0`,
    fortran: `      FUNCTION K31R(J,M,K,L,R, JA)
C BY PAULA GAIL GRISELL
C  EDITED FROM BASIC BY AX, 1.17.79
      k31r=ja    ! Added 7/27/93 to report own old value
      IF(M.EQ.1) S=0.
      S=S+J
      A=S/M
      K31R=1
      IF (A .LT..5) K31R=0
      RETURN
      END`,
  },

  // ------------------------------------------------------------ Soft Majority
  softmaj: {
    author: 'Variante clémente classique',
    fortranFile: null,
    py: `class Player:
    def __init__(self):
        self.defects = 0
        self.coops = 0

    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        if current_turn == 1 or opponent_last_move < 0:
            self.defects = 0
            self.coops = 0
            return 0
        if opponent_last_move == 1:
            self.defects += 1
        else:
            self.coops += 1
        # coopère sauf si l'adversaire a trahi strictement plus qu'il n'a coopéré
        return 1 if self.defects > self.coops else 0`,
    fortran: null,
  },

  // -------------------------------------------------------------- Periodic CCD
  ccd: {
    author: 'Stratégie périodique classique',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        # cycle : Coopérer, Coopérer, Trahir, ...
        return 1 if (current_turn - 1) % 3 == 2 else 0`,
    fortran: null,
  },

  // ------------------------------------------------------------------- Random
  random: {
    author: 'Étalon stochastique (codé par Axelrod)',
    fortranFile: 'KRandomC.f',
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        # coopère ou trahit au hasard (50/50), sans mémoire
        return 0 if random_value < 0.5 else 1`,
    fortran: `      Function KRandomC(J,M,K,L,R)        ! Random, Row Rule
      KRandomC = 0
      if (R .LE. .5) KRandomC = 1
      Return
      End     ! Random Col Rule`,
  },

  // -------------------------------------------------------- Always Cooperate
  allc: {
    author: 'Ligne de base (« sainte »)',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        return 0                      # coopère toujours, quoi qu'il arrive`,
    fortran: null,
  },

  // ----------------------------------------------------------- Always Defect
  alld: {
    author: 'Ligne de base (« traître pur »)',
    fortranFile: null,
    py: `class Player:
    def decide(self, opponent_last_move, current_turn,
               my_score, opponent_score, random_value, my_last_move):
        return 1                      # trahit toujours`,
    fortran: null,
  },
};
