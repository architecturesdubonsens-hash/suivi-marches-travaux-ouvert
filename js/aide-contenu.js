// js/aide-contenu.js — SOURCE UNIQUE de tout texte d'aide de l'application.
//
// POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST SEUL.
// L'aide vivait dans js/ui/aide.js, mêlée au rendu de la fenêtre. Ajouter une aide
// contextuelle aurait créé un SECOND gisement de texte : deux endroits à corriger
// quand une règle change, donc deux versions de la même règle, dont une fausse. Le
// texte est donc extrait ici, en données, et le rendu ne fait plus que le consommer.
// Règle tenue sans exception : AUCUNE phrase d'aide n'est écrite dans le balisage,
// dans un attribut title, ni dans un écran. Si elle doit s'afficher, elle est ici.
//
// DEUX REGISTRES, QUI NE SE MÉLANGENT PAS.
//   SECTIONS — découverte de l'outil. Où l'on clique, ce que fait chaque écran, la
//     mise en service. On le lit UNE fois. C'est le mode d'emploi, ouvert depuis
//     l'en-tête.
//   FICHES — rappel métier. Ce qu'il faut faire À CE MOMENT du marché, et ce qui
//     engage. On le relit à chaque opération, des mois plus tard, au moment de
//     l'acte. C'est l'aide contextuelle, ouverte depuis le titre concerné.
// La distinction n'est pas cosmétique : un rappel métier placé dans un mode d'emploi
// n'est jamais relu, et une explication d'interface placée dans une bulle encombre
// celui qui sait déjà cliquer.
//
// CE QUI N'EST PAS DE L'AIDE, ET N'ENTRE PAS ICI.
// Un avertissement de sécurité ou de conformité n'est pas de l'aide : il doit être
// VU sans être cherché.
// Les avertissements vivent donc dans js/ui/avertissements.js et s'affichent à
// l'écran. Le mode d'emploi peut les REFLÉTER (bloc « etatBase »), jamais les
// héberger seul.
//
// INTERDICTION DE DONNÉES RÉELLES. Aucun nom d'entreprise, aucune raison sociale,
// aucun SIREN/SIRET, aucune référence d'opération, aucun montant de dossier réel
// dans ce fichier : il est servi publiquement, comme tout js/. Les exemples sont
// fictifs et évidemment tels. Contrôlé par tests/verif-coherence-aide.mjs, qui
// refuse une suite de 9 chiffres ou plus et tout nom du référentiel.

/* ==================================================================== */
/* 1. La chronologie du marché — l'ossature du registre métier          */
/* ==================================================================== */

// Les quatre ÉCRANS de l'application ne sont pas les huit MOMENTS d'un marché de
// travaux. L'outil couvre aujourd'hui la passation et le suivi des avenants ; il
// s'arrête avant la réception. Taire les phases non couvertes laisserait croire
// qu'un dossier complet ici est un marché complet. On les porte donc, avec leur
// état de couverture — « absent » est une information utile, pas un aveu.
//
// couverture : 'outil'   — l'application produit la pièce ou tient le compte ;
//              'partiel' — elle tient une partie, le reste est hors outil ;
//              'absent'  — hors périmètre à ce jour, à tenir ailleurs.
export const JALONS = [
  {
    cle: 'passation',
    titre: 'Passation et signature du marché',
    couverture: 'outil',
    quoi: "Le devis retenu, variantes arbitrées, devient le montant du marché. Le marché est édité "
      + "par lot, dans le gabarit de l'agence, et signé par les deux parties.",
    engage: "La signature fige le montant initial : toute évolution ultérieure passera par un avenant, "
      + "et sera chaînée sur ce montant. C'est la valeur de référence de tout le reste — retenue de "
      + "garantie, pénalités, pourcentage cumulé des avenants.",
    fiche: 'montant-marche',
  },
  {
    cle: 'pieces',
    titre: 'Pièces administratives et assurances',
    couverture: 'outil',
    quoi: "Kbis, RCD, RC, vigilance URSSAF, régularité fiscale, RIB — recueillis avant tout démarrage, "
      + "et confrontés au lot de l'entreprise.",
    engage: "C'est la phase la plus souvent bâclée et la seule dont le défaut se paie des années plus "
      + "tard. Une décennale absente, échue à l'ouverture du chantier, ou qui ne garantit pas l'activité "
      + "du lot, laisse le maître d'ouvrage sans recours et met en cause le devoir de conseil de "
      + "l'architecte. L'application contrôle ces trois points et explique son verdict.",
    fiche: 'assurances-verdict',
  },
  {
    cle: 'os',
    titre: 'Ordre de service — démarrage',
    couverture: 'outil',
    quoi: "L'OS n°1 donne la date de début des travaux, d'où découle le délai contractuel.",
    engage: "L'OS fait courir le délai : c'est lui, et non la signature, qui ouvre le compte à rebours "
      + "des pénalités de retard. Un OS daté à la légère déplace la date à laquelle les pénalités "
      + "deviennent exigibles.",
    fiche: 'os',
  },
  {
    cle: 'chantier',
    titre: 'Suivi de chantier — comptes rendus',
    couverture: 'partiel',
    quoi: "Le CRC recense les intervenants, les points traités et les décisions. L'application produit "
      + "le canevas par lots ; les comptes rendus successifs se tiennent hors outil.",
    engage: "Le compte rendu est la trace écrite des décisions prises oralement. En cas de litige, c'est "
      + "lui qui établit ce qui a été demandé, quand, et à qui — un défaut non consigné est un défaut "
      + "difficile à imputer.",
    fiche: 'crc',
  },
  {
    cle: 'avenants',
    titre: 'Avenants et travaux modificatifs',
    couverture: 'outil',
    quoi: "Chaque modification du montant ou de la consistance du marché fait l'objet d'une fiche "
      + "d'avenant, chaînée sur le montant initial et sur les avenants précédents.",
    engage: "Le cumul compte plus que l'avenant isolé. L'application tient le chaînage et le pourcentage "
      + "cumulé, et ne crée JAMAIS un avenant toute seule.",
    fiche: 'avenant',
  },
  {
    cle: 'situations',
    titre: 'Situations de travaux et acomptes',
    couverture: 'absent',
    quoi: "Les demandes de paiement périodiques de l'entreprise, visées par la maîtrise d'œuvre, et la "
      + "retenue de garantie prélevée sur chacune.",
    engage: "Hors périmètre de l'application à ce jour : elle calcule le taux de retenue applicable, "
      + "mais ne tient pas le compte des situations. À suivre dans le tableau de l'agence — et à ne pas "
      + "croire tenu ici.",
    fiche: 'parametres-financiers',
  },
  {
    cle: 'reception',
    titre: 'Réception et réserves',
    couverture: 'absent',
    quoi: "Le procès-verbal de réception, avec ou sans réserves, prononcé par le maître d'ouvrage.",
    engage: "La réception est le pivot juridique du marché : elle fait partir les garanties légales "
      + "(parfait achèvement, bon fonctionnement, décennale), arrête le décompte des pénalités et "
      + "transfère la garde de l'ouvrage. Hors périmètre de l'application — à établir hors outil, et "
      + "surtout à ne pas oublier de dater.",
    fiche: 'reception',
  },
  {
    cle: 'dgd',
    titre: 'Levée des réserves et décompte général définitif',
    couverture: 'absent',
    quoi: "La levée des réserves consignée, puis le DGD qui arrête les comptes et libère la retenue de "
      + "garantie.",
    engage: "Tant que le DGD n'est pas établi et accepté, les comptes restent ouverts. Hors périmètre de "
      + "l'application — c'est la phase la plus souvent laissée en suspens, et celle qui immobilise "
      + "l'argent de l'entreprise.",
    fiche: 'dgd',
  },
];

/* ==================================================================== */
/* 2. FICHES — le rappel métier, contextuel, à la demande               */
/* ==================================================================== */

// Chaque fiche porte :
//   cle      — identité de la fiche. C'est la MÊME chaîne que l'écran passe à
//              boutonAide() : il n'existe pas de table de correspondance à
//              maintenir en parallèle. (Le défaut de non-correspondance de clés
//              observé sur la barre de guidage de CapInSitu vient précisément
//              d'un dictionnaire d'ancres tenu à la main à côté des identifiants
//              réels. On ne le reproduit pas : la clé EST l'identifiant.)
//   titre    — en-tête de la bulle.
//   section  — titre EXACT d'une entrée de SECTIONS, vers laquelle la bulle
//              renvoie (« Tout le mode d'emploi »). Vérifié par les tests.
//   jalon    — clé d'un JALONS, pour situer la fiche dans la chronologie.
//   blocs    — même grammaire que SECTIONS (p, ul, attention, etapes, cle).
//
// Le bloc 'attention' d'une fiche sert au rappel de ce qui ENGAGE. Il ne sert
// jamais à un avertissement d'état (sécurité, conformité du projet en cours) :
// ceux-là s'affichent à l'écran, voir js/ui/avertissements.js.
export const FICHES = [
  {
    cle: 'operation',
    titre: "L'opération : DROC et ouverture de chantier",
    section: 'Le parcours en quatre étapes',
    jalon: 'passation',
    blocs: [
      ['p', "La référence et l'intitulé identifient le dossier partout ailleurs — dans le nom des "
        + "fichiers produits comme dans la liste des dossiers de la base. Ils se saisissent une fois."],
      ['p', "Deux dates se ressemblent et ne font pas le même travail :"],
      ['ul', [
        "DROC — déclaration réglementaire d'ouverture de chantier, adressée à l'administration. C'est une "
          + "formalité d'urbanisme.",
        "Ouverture de chantier — la date réelle de démarrage. C'est elle, et elle seule, qui doit tomber "
          + "dans la période de validité de l'attestation décennale.",
      ]],
      ['attention', "Si l'ouverture de chantier n'est pas saisie, l'application retient la DROC comme "
        + "PRÉSUMÉE pour contrôler les assurances, et le dit dans le verdict par une mention « [info] ». "
        + "Le contrôle reste approximatif tant que la vraie date n'est pas renseignée : une couverture "
        + "jugée bonne sur la DROC peut être fausse sur l'ouverture réelle, si les deux dates s'écartent."],
      ['p', "La durée prévisionnelle en mois sert à calculer la fin de chantier attendue, donc à détecter "
        + "une garantie qui expirera avant la fin des travaux."],
    ],
  },
  {
    cle: 'parametres-financiers',
    titre: 'Retenue de garantie et pénalités de retard',
    section: 'Le parcours en quatre étapes',
    jalon: 'situations',
    blocs: [
      ['p', "Ces deux paramètres ne produisent aucun document à eux seuls : ils alimentent les calculs "
        + "repris dans le marché et dans les pièces."],
      ['etapes', [
        ['Retenue de garantie', "Prélevée sur chaque paiement, elle garantit l'exécution jusqu'à la "
          + "levée des réserves. Le taux usuel est de 5 %, et c'est la valeur par défaut. Elle se "
          + "substitue à une caution bancaire quand l'entreprise n'en fournit pas — et dans ce cas elle "
          + "n'est libérée qu'au décompte général définitif."],
        ['Pénalités de retard', "Elles courent à compter de la date fixée par l'ordre de service, et "
          + "s'arrêtent à la réception. Deux valeurs les commandent : le taux journalier (exprimé en "
          + "fraction du montant du marché) et le plafond, en pourcentage de ce même montant."],
      ]],
      ['attention', "Le plafond est appliqué par le calcul : au-delà, le montant est écrêté, et le "
        + "chiffre affiché n'est plus proportionnel au retard. Un plafond atteint signifie que le retard "
        + "n'est plus sanctionné financièrement au-delà — c'est un fait à connaître avant de s'appuyer "
        + "sur la pénalité comme moyen de pression. Mettre le plafond à vide le désactive entièrement."],
      ['p', "L'application ne tient pas le compte des situations de travaux : elle fournit le taux, pas "
        + "le tableau des acomptes."],
    ],
  },
  {
    cle: 'depot-devis',
    titre: "Les devis : ce que la lecture du PDF garantit, et ce qu'elle ne garantit pas",
    section: 'Le parcours en quatre étapes',
    jalon: 'passation',
    blocs: [
      ['p', "Le devis retenu devient la base du marché : son montant, ses variantes et sa désignation de "
        + "lot sont repris tels quels dans la pièce signée."],
      ['p', "Quand le PDF porte une couche texte, l'application y lit le numéro, la date et le montant HT "
        + "pour éviter la ressaisie. Rien n'est deviné : ce qui n'a pas été lu reste vide, et tout ce qui a "
        + "été lu reste modifiable."],
      ['attention', "Une valeur pré-remplie n'est pas une valeur vérifiée. Un devis scanné sans couche "
        + "texte ne donne rien du tout, et un devis mal structuré peut donner un montant juste associé à "
        + "une mauvaise date. Le montant qui engage est celui que vous relisez sur la pièce."],
      ['p', "Un devis peut être remplacé à tout moment. Après signature du marché, un remplacement ne "
        + "crée jamais d'avenant automatiquement : l'application signale l'écart, et l'architecte décide."],
    ],
  },
  {
    cle: 'depot-pieces',
    titre: 'Les pièces administratives : lesquelles bloquent, et pourquoi',
    section: 'Le parcours en quatre étapes',
    jalon: 'pieces',
    blocs: [
      ['p', "Six pièces sont tenues pour obligatoires avant tout démarrage. Les autres sont des pièces de "
        + "suivi, demandées en pratique selon le lot."],
      ['ul', [
        "Extrait Kbis — l'entreprise existe, et la personne qui signe a qualité pour l'engager.",
        "Attestation de responsabilité civile décennale (RCD) — obligation d'assurance de l'article "
          + "L. 241-1 du Code des assurances. C'est la pièce dont l'absence coûte le plus cher, et le plus tard.",
        "Attestation de responsabilité civile — les dommages causés pendant le chantier.",
        "Vigilance URSSAF — l'entreprise est à jour de ses cotisations. Elle vous protège de la "
          + "solidarité financière en cas de travail dissimulé.",
        "Régularité fiscale — même logique, côté impôts.",
        "RIB — pour payer la bonne entreprise sur le bon compte.",
      ]],
      ['attention', "L'attestation de vigilance URSSAF a une validité courte. Une pièce valable à la "
        + "consultation peut être périmée au démarrage : c'est la date d'ouverture du chantier qui "
        + "compte, pas celle du dépôt."],
      ['p', "Les certificats de qualification et les attestations de travail régulier ne bloquent pas la "
        + "validation, mais leur absence sur un lot technique se remarque en cas de sinistre."],
    ],
  },
  {
    cle: 'assurances-verdict',
    titre: 'Lire le voyant d\'assurance',
    section: 'Le parcours en quatre étapes',
    jalon: 'pieces',
    blocs: [
      ['p', "Le voyant résume le contrôle de la décennale de l'entreprise, lot par lot. Il ne remplace "
        + "pas la lecture de l'attestation : il dit où regarder."],
      ['etapes', [
        ['Rouge — ne pas démarrer sans avoir tranché', "Décennale absente du dossier ; ouverture de "
          + "chantier hors de la période de garantie (commencée trop tard, ou déjà échue) ; AUCUNE "
          + "activité garantie ne correspond au lot ; une exclusion nommée de la police touche le lot ; "
          + "le coût du chantier dépasse le seuil opposable de la police."],
        ['Orange — à vérifier, pas à ignorer', "La garantie expire avant la fin prévisionnelle des "
          + "travaux ; l'adéquation entre le lot et les activités garanties est faible ; la période de "
          + "garantie est illisible sur la pièce ; l'ouverture de chantier est inconnue, donc la "
          + "couverture dans le temps n'est pas vérifiable."],
        ['Mention « [info] »', "Une précision sur la façon dont le contrôle a été mené — typiquement : "
          + "l'ouverture de chantier a été présumée égale à la DROC faute d'être saisie. Cela ne dégrade "
          + "pas le voyant, mais cela dit que le contrôle repose sur une hypothèse."],
        ['Vert sans aucune raison affichée', "Le cas le plus rare, et le seul rassurant : toutes les "
          + "dates sont saisies, la garantie couvre la période, et l'activité correspond au lot."],
      ]],
      ['p', "L'adéquation activité/lot est obtenue en rapprochant le libellé du lot des activités "
        + "énumérées sur l'attestation, par un dictionnaire de synonymes métier. Un score nul signifie "
        + "qu'aucun terme ne se recoupe — souvent une attestation qui couvre un autre métier que celui "
        + "qu'on fait faire à l'entreprise."],
      ['attention', "Un score faible n'est pas forcément un défaut de couverture : il peut venir d'une "
        + "attestation rédigée en termes généraux, ou d'un lot nommé de façon inhabituelle. C'est un "
        + "signal d'aller lire, pas un verdict juridique. Inversement, un score élevé ne vaut pas "
        + "garantie : seule la police fait foi."],
      ['p', "Deux seuils de coût figurent sur les attestations types et sont confrontés au coût de "
        + "l'opération : celui des ouvrages soumis à obligation d'assurance, et celui des ouvrages non "
        + "soumis, plus bas. Au-delà du seuil applicable, la garantie ne joue pas sans avenant "
        + "d'adaptation. Le champ « ouvrage soumis » de l'écran Configuration choisit lequel s'applique ; "
        + "laissé indéterminé, il déclenche une vigilance orange."],
    ],
  },
  {
    cle: 'montant-marche',
    titre: 'Le montant du marché : variantes, prorata, montant en lettres',
    section: 'Le parcours en quatre étapes',
    jalon: 'passation',
    blocs: [
      ['p', "Le montant du marché est le devis de base, augmenté des seules variantes et options "
        + "effectivement retenues avec le maître d'ouvrage. Cocher une variante la fait entrer dans le "
        + "montant, et dans la pièce signée."],
      ['p', "Le compte de prorata, quand il s'applique, est prélevé en pourcentage et apparaît "
        + "distinctement : il n'est pas fondu dans le montant des travaux."],
      ['p', "Le montant est transcrit en lettres automatiquement, parce que c'est la mention en lettres "
        + "qui prévaut en cas de divergence avec les chiffres dans un acte."],
      ['attention', "Modifier une variante APRÈS signature ne modifie pas le marché signé : cela crée un "
        + "écart entre le dossier et la pièce en vigueur. L'évolution d'un marché signé passe par un "
        + "avenant, jamais par une correction du montant initial."],
    ],
  },
  {
    cle: 'os',
    titre: "L'ordre de service : ce qu'il déclenche",
    section: 'Le parcours en quatre étapes',
    jalon: 'os',
    blocs: [
      ['p', "L'ordre de service est l'acte par lequel la maîtrise d'œuvre enjoint à l'entreprise de "
        + "commencer, de poursuivre, ou d'exécuter une prestation. L'OS n°1 porte la date de début des "
        + "travaux."],
      ['attention', "La date de l'OS fait courir le délai contractuel. C'est de là que se compte le "
        + "retard, donc les pénalités — pas de la signature du marché, pas de la DROC. Une date posée "
        + "approximativement déplace d'autant le moment où les pénalités deviennent exigibles."],
      ['ul', [
        "Un OS se numérote en continu par entreprise : la suite doit être sans trou pour être opposable.",
        "Un OS qui modifie le montant ou la consistance du marché appelle un avenant — l'OS notifie, "
          + "l'avenant contractualise. Les deux ne se remplacent pas.",
        "Un OS de prolongation de délai se date lui aussi : sans écrit, le délai initial reste celui "
          + "qui fait foi.",
      ]],
    ],
  },
  {
    cle: 'avenant',
    titre: 'Avenants : le chaînage, et le seuil qui compte',
    section: 'Le parcours en quatre étapes',
    jalon: 'avenants',
    blocs: [
      ['p', "Un avenant modifie un marché signé. L'application le chaîne : chaque avenant s'appuie sur le "
        + "montant initial ET sur les avenants précédents, pour donner le nouveau montant du marché et le "
        + "pourcentage cumulé d'évolution. Plus-values et moins-values se compensent dans ce cumul."],
      ['attention', "C'est le CUMUL qui engage, pas l'avenant isolé. Trois avenants de faible montant "
        + "peuvent franchir ensemble un seuil qu'aucun n'atteint seul. Le chiffre à regarder est donc le "
        + "pourcentage cumulé, affiché à côté du nouveau montant."],
      ['p', "Quel seuil ? Il n'y a pas de pourcentage légal universel pour un marché privé : le seuil "
        + "opposable est celui qu'écrit le marché lui-même, dans ses clauses de variation. Deux seuils "
        + "existent en revanche indépendamment du contrat, et l'application les contrôle :"],
      ['ul', [
        "les seuils de coût de la police décennale — un marché qui grossit par avenants peut franchir "
          + "le plafond de l'attestation déposée, et sortir de la garantie sans que personne ne le voie "
          + "passer ;",
        "la fin prévisionnelle de chantier — un avenant qui allonge le délai peut faire expirer la "
          + "garantie avant la fin des travaux.",
      ]],
      ['p', "Après un avenant qui modifie montant ou délai, il vaut donc la peine de relire le voyant "
        + "d'assurance : il est recalculé, et il peut avoir changé de couleur."],
      ['attention', "Un marché passé par un maître d'ouvrage public relève d'un régime de modification "
        + "qui lui est propre, avec ses propres seuils et ses propres formalités. L'application ne le "
        + "traite pas : ne pas transposer ce qui précède à une opération publique."],
      ['p', "Remplacer un devis ne produit JAMAIS un avenant automatiquement, même après signature. "
        + "L'application prépare la fiche et signale l'écart ; la décision est celle de l'architecte."],
    ],
  },
  {
    cle: 'crc',
    horsEcran: true, // aucune carte d'écran ne porte cette phase : rendue dans le mode d'emploi
    titre: 'Le compte rendu de chantier',
    section: 'Le parcours en quatre étapes',
    jalon: 'chantier',
    blocs: [
      ['p', "L'application produit le canevas du compte rendu : l'en-tête de l'opération, les "
        + "intervenants par lot avec leurs coordonnées, et les rubriques à remplir. Les cellules à "
        + "compléter à la main sont laissées vides, sans pointillés — un blanc se voit, un pointillé "
        + "se confond avec une valeur."],
      ['p', "Le compte rendu de chantier est la trace écrite de décisions prises oralement. Sa valeur "
        + "ne vient pas de sa mise en forme mais de sa régularité et de sa diffusion : un CRC non "
        + "diffusé ne prouve rien."],
      ['attention', "Les comptes rendus successifs ne sont pas tenus par l'application : elle fournit "
        + "le canevas, pas l'historique. La numérotation et l'archivage restent à la charge de l'agence."],
    ],
  },
  {
    cle: 'reception',
    horsEcran: true, // aucune carte d'écran ne porte cette phase : rendue dans le mode d'emploi
    titre: 'Réception et réserves — hors périmètre, mais déterminant',
    section: 'Le marché dans le temps',
    jalon: 'reception',
    blocs: [
      ['p', "L'application s'arrête avant la réception. Cette fiche est là pour que la suite ne soit pas "
        + "oubliée faute d'écran — pas pour laisser croire qu'elle est gérée ici."],
      ['p', "La réception est l'acte par lequel le maître d'ouvrage déclare accepter l'ouvrage, avec ou "
        + "sans réserves. Elle se constate par procès-verbal, et sa date est le pivot de tout ce qui suit :"],
      ['ul', [
        "elle fait partir la garantie de parfait achèvement, celle de bon fonctionnement, et la décennale ;",
        "elle arrête le décompte des pénalités de retard ;",
        "elle transfère la garde de l'ouvrage au maître d'ouvrage, ce qui déplace la charge de l'assurance ;",
        "elle ouvre le délai de levée des réserves consignées au procès-verbal.",
      ]],
      ['attention', "Une réception prononcée sans procès-verbal daté, ou une prise de possession sans "
        + "réception formelle, laisse les garanties dans l'incertitude. C'est le genre d'oubli qui ne se "
        + "découvre qu'au premier sinistre."],
      ['p', "À tenir hors outil : procès-verbal de réception, liste des réserves, et la date."],
    ],
  },
  {
    cle: 'dgd',
    horsEcran: true, // aucune carte d'écran ne porte cette phase : rendue dans le mode d'emploi
    titre: 'Levée des réserves et décompte général définitif — hors périmètre',
    section: 'Le marché dans le temps',
    jalon: 'dgd',
    blocs: [
      ['p', "Dernière phase, et la plus souvent laissée en suspens. L'application ne la couvre pas."],
      ['etapes', [
        ['Levée des réserves', "Chaque réserve du procès-verbal se lève par un constat écrit. Tant "
          + "qu'une réserve reste ouverte, la retenue de garantie correspondante n'a pas à être libérée."],
        ['Décompte général définitif', "Il arrête les comptes du marché : montant initial, avenants, "
          + "travaux non exécutés, pénalités éventuelles, acomptes déjà versés. Accepté par les deux "
          + "parties, il rend les comptes définitifs."],
        ['Libération de la retenue', "Elle suit la levée des réserves et l'établissement du décompte. "
          + "Une retenue oubliée immobilise de l'argent qui n'est plus garanti par rien."],
      ]],
      ['attention', "Un marché dont le décompte général n'est jamais établi reste ouvert : les comptes "
        + "ne sont pas arrêtés, et le solde reste réclamable. C'est la situation la plus fréquente, et "
        + "elle ne se signale par aucune alerte — ni ici, ni ailleurs."],
    ],
  },
  {
    cle: 'generation',
    titre: 'Ce que produit la génération',
    section: 'Le parcours en quatre étapes',
    jalon: 'passation',
    blocs: [
      ['p', "Un seul bouton produit l'ensemble du dossier en archive ZIP, classé par nature de pièce : "
        + "marchés par lot, ordres de service, compte rendu, fiches d'avenant, et l'état complet du "
        + "dossier au format JSON."],
      ['p', "Les pièces sont écrites dans les gabarits réels de l'agence : la mise en page, les en-têtes "
        + "et les styles sont ceux des documents habituels, pas une reconstitution."],
      ['attention', "Les pièces produites ne sont pas des pièces signées. Un marché généré est un projet "
        + "de marché jusqu'à signature des deux parties, et le dossier reste modifiable après génération "
        + "— ce qui veut dire que l'archive et le dossier peuvent diverger. Régénérer après toute "
        + "modification est plus sûr que de conserver une ancienne archive."],
      ['p', "Le fichier JSON est le format d'échange : il se réimporte tel quel, et sert aussi au "
        + "transfert entre postes quand la base partagée n'est pas utilisée."],
    ],
  },
];

/* ==================================================================== */
/* 3. SECTIONS — le mode d'emploi, découverte de l'outil                */
/* ==================================================================== */

/* Le contenu, en données : chaque section porte un titre et une suite de blocs.
   Types de bloc : p (paragraphe), ul (liste), etapes (liste numérotée titrée),
   attention (avertissement), tableau (entêtes + lignes), cle (libellé + touche),
   etatBase (état vivant de la base, lu à l'ouverture), jalons (la chronologie). */
export const SECTIONS = [
  {
    titre: "Ce que fait l'application",
    blocs: [
      ["p", "À partir d'une saisie UNIQUE, elle produit le marché de travaux, les ordres de service, le CRC et les "
        + "fiches d'avenant — dans les gabarits réels de l'agence. Aucune donnée n'est ressaisie d'un document à l'autre."],
      ["p", "Elle fonctionne sans installation et sans connexion. Le dossier vit dans le navigateur ; il peut aussi être "
        + "partagé entre les postes par la base partagée (voir « Dossier partagé »)."],
      ["p", "Elle couvre la passation et le suivi des avenants. Elle s'arrête avant la réception : voir « Le marché "
        + "dans le temps » pour ce qui reste à tenir hors outil."],
    ],
  },
  {
    titre: "Le parcours en quatre étapes",
    blocs: [
      ["etapes", [
        ["Configuration", "L'opération (référence, intitulé, DROC), le maître d'ouvrage, l'agence. C'est la saisie unique : "
          + "tout le reste s'en déduit. Rien de ce qui est inconnu n'est inventé — les champs vides le restent."],
        ["Dépôt", "Les devis (.pdf) et les pièces administratives. La couche texte des PDF pré-remplit numéro, date et "
          + "montant HT : tout reste modifiable, et rien n'est deviné — ce qui n'a pas été lu reste vide."],
        ["Validation", "On coche les variantes retenues avec le maître d'ouvrage. Les montants et leur transcription en "
          + "lettres se recalculent. Le voyant d'assurance résume la conformité décennale."],
        ["Génération", "Un seul bouton produit le dossier complet en ZIP, classé : 01_MARCHES, 02_OS, 03_CRC, "
          + "04_SUIVI_AVENANTS, plus l'état complet PROJET.json."],
      ]],
      ["p", "Une entreprise peut être créée AVANT son devis, et un devis changer en cours de route. Le dossier reste "
        + "utilisable même incomplet : c'est le principe des lignes en blanc."],
      ["p", "Chaque titre d'écran porte un bouton « ? » : il ouvre le rappel métier du moment — ce qu'il faut faire à "
        + "cette étape du marché, et ce qui engage. C'est là que vivent les règles de fond, pas ici."],
    ],
  },
  {
    titre: "Le marché dans le temps",
    blocs: [
      ["p", "Les quatre écrans de l'application ne sont pas les huit moments d'un marché de travaux. Voici la "
        + "chronologie réelle, et ce que l'outil en tient — « hors outil » veut dire qu'il faut le tenir ailleurs, "
        + "pas que ça n'a pas lieu."],
      ["jalons"],
      ["p", "Les trois phases qui ne sont portées par aucun écran sont détaillées ci-dessous : sans cela, leur rappel métier serait écrit sans être atteignable."],
      ["fichesHorsEcran"],
    ],
  },
  {
    titre: "Dossier partagé : la barre du haut",
    blocs: [
      ["p", "La barre « Dossier partagé » est visible sur TOUS les écrans, en haut. C'est là, et nulle part ailleurs, "
        + "qu'on se connecte et qu'on choisit une opération."],
      ["ul", [
        "Se connecter — courriel et mot de passe de votre compte (« Créer un compte » si vous n'en avez pas encore). Sans connexion, tout continue de fonctionner : le dossier "
          + "reste simplement dans ce navigateur.",
        "Choisir un dossier — la liste déroulante donne les dossiers déjà enregistrés dans la base.",
        "Enregistrer — « Créer dans la base » la première fois, « Enregistrer » ensuite. Le numéro de version s'affiche à côté.",
        "Se déconnecter — le dossier en cours reste dans le navigateur.",
      ]],
      ["attention", "Si un autre poste a enregistré entre-temps, votre version n'est PAS écrasée. L'application vous "
        + "le dit, donne la version distante, et propose soit d'enregistrer votre version comme nouveau dossier, soit de "
        + "recharger celle de la base."],
      ["p", "Ouvrir un dossier REMPLACE celui en cours. Si celui-ci contient des modifications non enregistrées, "
        + "l'application demande confirmation avant — jamais après."],
    ],
  },
  {
    titre: "Les comptes : créer le sien, et garder ses dossiers privés",
    blocs: [
      ["p", "Chacun crée son propre compte : barre du haut, « Créer un compte », avec un courriel et un mot de passe. "
        + "Aucune autorisation n'est nécessaire."],
      ["p", "Vos dossiers vous appartiennent. Personne d'autre ne peut les lire, les modifier, les supprimer ni se les "
        + "attribuer : cette règle est appliquée par la base de données elle-même, et pas seulement par l'écran."],
      ["p", "Selon la configuration du service, un courriel de confirmation peut vous être envoyé : cliquez le lien qu'il "
        + "contient, puis connectez-vous."],
      ["p", "Vous pouvez changer votre mot de passe à tout moment : barre du haut, « Mon mot de passe »."],
    ],
  },
  {
    titre: "Mise en service, une fois — pour celui qui déploie l'application",
    blocs: [
      ["p", "Cette partie ne concerne que la personne qui met l'application en ligne avec une base partagée. Sans base "
        + "configurée, l'application fonctionne entièrement dans le navigateur."],
      ["etapes", [
        ["Le projet", "Créer un projet sur Supabase (ou un service compatible) et noter son adresse et sa clé publique."],
        ["Le schéma", "Exécuter le contenu de db/schema.sql dans l'éditeur SQL : table des dossiers et politiques d'accès "
          + "par propriétaire."],
        ["Le contrôle", "Exécuter db/test-isolation.sql : les 10 lignes doivent toutes afficher ok = true. Ce banc prouve "
          + "qu'un utilisateur ne peut rien lire ni modifier chez un autre ; tout est annulé à la fin, rien ne subsiste."],
        ["La configuration", "Renseigner l'adresse et la clé publique du projet dans js/config.js."],
        ["L'authentification", "Authentication, puis Providers, puis Email : « Enable Email provider » ALLUMÉ, et "
          + "« Allow new users to sign up » ALLUMÉ. Pour la confirmation par courriel, voir la remarque ci-dessous."],
      ]],
      ["p", "État de la base, relu à l'instant où cette fenêtre s'ouvre :"],
      ["etatBase"],
      ["attention", "Courriel de confirmation : le service de courrier intégré à Supabase est fortement limité (débit et "
        + "destinataires). Pour accueillir des utilisateurs extérieurs, configurez votre propre serveur de courrier (SMTP) "
        + "dans Authentication, ou désactivez l'exigence de confirmation — en sachant alors que n'importe quelle adresse "
        + "sera acceptée à l'inscription."],
      ["tableau",
        ["Réglage", "On veut", "Si on se trompe"],
        [
          ["Enable Email provider", "Allumé", "Personne ne peut se connecter ni créer de compte"],
          ["Allow new users to sign up", "Allumé", "Personne ne peut créer de compte"],
        ]],
    ],
  },
  {
    titre: "Questions fréquentes",
    blocs: [
      ["cle", "Je ne vois pas où me connecter.", "La barre « Dossier partagé » est en haut de l'écran, sur les quatre "
        + "étapes. Elle n'apparaît pas si aucune base n'est configurée : dans ce cas l'application est purement locale."],
      ["cle", "Mes modifications sont-elles enregistrées ?", "Oui, automatiquement, mais UNIQUEMENT dans ce navigateur, "
        + "sur ce poste : l'indicateur en haut à droite donne l'heure du dernier enregistrement. Vider les données du site, "
        + "changer d'ordinateur ou ouvrir une fenêtre de navigation privée vous ferait perdre le dossier."],
      ["cle", "Comment sauvegarder mon dossier, ou le reprendre sur un autre poste ?", "Exportez-le : bouton « Exporter le "
        + "dossier (JSON) », en haut de l'écran Configuration (et à la dernière étape). Conservez le fichier obtenu. Pour "
        + "reprendre, « Importer un dossier (JSON) » : l'import remplace le dossier en cours, après confirmation. Pour le "
        + "retrouver sans fichier sur plusieurs postes, il faut une base partagée : voir « Dossier partagé »."],
      ["cle", "Puis-je travailler sans connexion internet ?", "Oui. Le dossier reste dans le navigateur, et "
        + "l'enregistrement dans la base échoue avec un message clair. Rien n'est perdu."],
      ["cle", "Puis-je tester depuis le Mac du bureau ?", "Oui, par l'adresse de l'application : rien à installer. "
        + "Le fichier local ouvert directement (file://) ne fonctionne pas — il faut l'adresse web."],
      ["cle", "Un devis remplacé après signature fait-il un avenant ?", "Jamais automatiquement. L'application prépare "
        + "la fiche d'avenant et signale l'écart ; c'est l'architecte qui décide."],
      ["cle", "Puis-je repartir de zéro ?", "Oui : à la première ouverture, l'interface est vierge. Les données des "
        + "dossiers ne sont jamais pré-remplies."],
      ["cle", "Où sont passées les règles sur les avenants, la retenue de garantie, la réception ?", "Dans les bulles "
        + "« ? » à côté des titres d'écran, et dans « Le marché dans le temps » ci-dessus. Ce mode d'emploi explique "
        + "l'outil ; les bulles expliquent le marché."],
    ],
  },
];

/** Titres des sections : sommaire, et point de contrôle des tests. */
export const TITRES_AIDE = SECTIONS.map((s) => s.titre);

/** Retrouve une fiche par sa clé. Rend null si inconnue — l'appelant n'affiche rien. */
export function fiche(cle) {
  return FICHES.find((f) => f.cle === cle) ?? null;
}

/** Fiches qu'aucun écran ne porte : rendues dans le mode d'emploi, pour qu'aucune ne soit
    écrite sans être atteignable. Dérivé du champ porté PAR la fiche, pas d'une liste tenue
    à côté — c'est ce qui rend la vérification croisée des tests possible. */
export const FICHES_HORS_ECRAN = FICHES.filter((f) => f.horsEcran === true);

/** Retrouve un jalon par sa clé. */
export function jalon(cle) {
  return JALONS.find((j) => j.cle === cle) ?? null;
}
