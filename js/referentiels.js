// referentiels.js — données de référence de l'application (moteur métier).
//
// Ce module porte les constantes que les autres modules importent (contrat SPEC §8) :
// agence par défaut (vide), jeu d'entreprises d'EXEMPLE (toutes fictives), typologie
// des pièces administratives et dictionnaire de synonymes de lots utilisé par le
// contrôle d'adéquation assurances.
//
// Toute valeur inconnue est explicitement null (jamais devinée) — cf. MODELE-DONNEES.md.

// Agence par défaut : VIDE. Chaque utilisateur renseigne la sienne à l'écran
// Configuration ; rien n'est présupposé sur l'agence qui se sert de l'outil.
// lieuFait est le lieu porté dans le champ « FAIT À » des OS et avenants (le lieu de
// l'agence, pas celui de l'opération) : null tant que l'utilisateur ne l'a pas saisi.
export const AGENCE_PAR_DEFAUT = {
  raisonSociale: null,
  forme: null,
  representant: null,
  siren: null,
  siret: null,
  adresse: null,
  cp: null,
  ville: null,
  tel: null,
  email: null,
  // titreBloc : première ligne du bloc agence des gabarits (« L'agence
  // d'architecture » au-dessus de la raison sociale), paramétrable pour les variantes
  // d'en-tête d'autres documents.
  titreBloc: "L'agence d'architecture",
  lieuFait: null,
};

// Entreprises d'EXEMPLE — toutes fictives. Elles couvrent les lots d'un chantier tous
// corps d'état et servent aux tests et à la démonstration ; l'application n'en dépend pas.
// ids stables en minuscules : ils servent de clé de rapprochement partout
// (devis.entrepriseId, attestations.entrepriseId, OS.entrepriseId).
// lotNom : libellé du lot ; lotNumero : numéro de lot, quand il est connu.
// tel/email : extension au modèle SPEC §2 — null quand l'information manque.
export const ENTREPRISES_EXEMPLE = [
  {
    id: 'serrurex',
    raisonSociale: 'SERRUREX',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: '14 rue du Test',
    cp: '12270',
    ville: 'RIVEBELLE',
    tel: '01 00 00 00 02',
    email: 'contact@serrurex.example',
    lotNom: 'SERRURERIE',
    lotNumero: 12,
  },
  {
    id: 'atse',
    raisonSociale: 'ATELIER SERVICES ELECTRIQUES', // dénomination Kbis ; « ATSE » est le nom de dossier
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'TRANSFORMATEUR',
    lotNumero: null,
  },
  {
    id: 'betonor',
    raisonSociale: 'BETONOR TRAVAUX',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'GROS OEUVRE TRANSFO',
    lotNumero: null,
  },
  {
    id: 'voltalis',
    raisonSociale: 'SAS VOLTALIS',
    forme: 'S.A.S.',
    representant: 'Marc TEST',
    qualiteRepresentant: null, // le MT écrit « MONSIEUR AQUATHERM Marc » sans qualité
    siren: '100000041',
    siret: '10000004100024',
    adresse: 'ZA de l’Exemple - CS 0001, Rue du Vent-Test',
    cp: '12350',
    ville: 'VILLENEUVE-EXEMPLE',
    tel: null,
    email: null,
    lotNom: 'ELECTRICITE',
    lotNumero: null,
  },
  {
    id: 'aluminor',
    raisonSociale: 'ALUMINOR ALUMINIUM',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'MENUISERIES ALUMINIUM',
    lotNumero: null,
  },
  {
    id: 'climaxe',
    raisonSociale: 'CLIMAXE',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'CVC',
    lotNumero: null,
  },
  {
    id: 'eleval',
    raisonSociale: 'SA ELEVAL',
    forme: 'S.A.',
    representant: null,
    qualiteRepresentant: null,
    siren: '100000058', // « immatriculée sous le n°100000058 » sur son attestation RCD
    siret: null,
    adresse: 'ZAC de l’Exemple, 455 avenue du Test, CS 00000',
    cp: '12206',
    ville: 'GRANDVILLE CEDEX 3',
    tel: null,
    email: null,
    lotNom: 'ASCENSEURS',
    lotNumero: null,
  },
  {
    id: 'autoporte',
    raisonSociale: 'AUTOPORTE',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'PORTES AUTOMATIQUES',
    lotNumero: null,
  },
  {
    id: 'plateria',
    raisonSociale: 'SARL PLATERIA',
    forme: 'S.A.R.L.',
    representant: null,
    qualiteRepresentant: null,
    siren: '100000025',
    siret: null,
    adresse: '8 rue du Modèle, ZI Nord',
    cp: '12000',
    ville: 'HAUTMONT-TEST',
    tel: null,
    email: null,
    lotNom: 'PLATRERIE SOLS',
    lotNumero: null,
  },
  {
    id: 'aquatherm',
    raisonSociale: 'SEE AQUATHERM',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'PLOMBERIE',
    lotNumero: null,
  },
  {
    id: 'flexiport',
    raisonSociale: 'FLEXIPORT',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'PORTES SOUPLES',
    lotNumero: null,
  },
  {
    id: 'azurbat-const',
    raisonSociale: 'AZURBAT CONSTRUCTION',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'GROS OEUVRE',
    lotNumero: null,
  },
  {
    id: 'froidex-pro',
    raisonSociale: 'FROIDEX PRO',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'PANNEAUX FROIDS',
    lotNumero: null,
  },
  {
    id: 'toituria',
    raisonSociale: 'TOITURIA ENTREPRISES',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'BARDAGE COUVERTURES',
    lotNumero: null,
  },
  {
    id: 'colorama',
    raisonSociale: 'S.A.S. COLORAMA',
    forme: 'S.A.S.',
    representant: 'Morgan MODELE',
    qualiteRepresentant: 'gérant',
    siren: '100000082',
    siret: null,
    adresse: '80 traverse du Modèle',
    cp: '12780',
    ville: 'MONTCLAIR-TEST',
    tel: null,
    email: null,
    lotNom: 'PEINTURE',
    lotNumero: null,
  },
  {
    id: 'sprinka',
    raisonSociale: 'SPRINKA SUD OUEST',
    forme: null,
    representant: null,
    qualiteRepresentant: null,
    siren: null,
    siret: null,
    adresse: null,
    cp: null,
    ville: null,
    tel: null,
    email: null,
    lotNom: 'RIA SPK',
    lotNumero: 18,
  },
];

// Pièces administratives attendues au dépôt de chaque entreprise.
// obligatoire=true : pièce dont l'absence bloque la validation du dossier
// (avis du cabinet) ; obligatoire=false : pièce de suivi demandée en pratique.
// Les codes correspondent aux types de l'objet Attestation (SPEC §2) quand ils
// existent (RCD, RC, URSSAF, FISCALE, KBIS, QUALIBAT...), sinon à un code local.
export const TYPES_PIECES = [
  { code: 'KBIS', libelle: 'Extrait Kbis (immatriculation)', obligatoire: true, },
  { code: 'RCD', libelle: 'Attestation d\'assurance responsabilité civile décennale', obligatoire: true,
    sources: ['art. L. 241-1 du Code des assurances ; docs/cahier-des-charges.html §3.A'] },
  { code: 'RC', libelle: 'Attestation d\'assurance responsabilité civile (chantier)', obligatoire: true, },
  { code: 'URSSAF', libelle: 'Attestation de vigilance URSSAF', obligatoire: true, },
  { code: 'FISCALE', libelle: 'Attestation de régularité fiscale', obligatoire: true, },
  { code: 'RIB', libelle: 'Relevé d\'identité bancaire', obligatoire: true, },
  { code: 'QUALIBAT', libelle: 'Certificat de qualification professionnelle (Qualibat, Qualifelec...)', obligatoire: false, },
  { code: 'TRAVAIL_CACHE', libelle: 'Attestation de lutte contre le travail dissimulé', obligatoire: false, },
  { code: 'TRAVAILLEURS_ETRANGERS', libelle: 'Attestation relative aux travailleurs étrangers', obligatoire: false, },
  { code: 'CIBTP', libelle: 'Attestation de régularité CIBTP (congés payés)', obligatoire: false, },
  { code: 'PRO_BTP', libelle: 'Attestation PRO BTP (retraite)', obligatoire: false, },
  { code: 'SUR_HONNEUR', libelle: 'Attestation sur l\'honneur', obligatoire: false, },
  { code: 'NON_CONDAMNATION', libelle: 'Attestation de non-condamnation', obligatoire: false, },
  { code: 'AUTRE', libelle: 'Autre pièce', obligatoire: false, },
];

// Dictionnaire de rapprochement lot <-> activités garanties par les polices
// d'assurance. Consommé par adequationActivite() de js/assurances.js.
// - cle          : clé canonique du dictionnaire (usage interne)
// - libelle      : libellé métier du groupe de lots
// - synonymes    : termes retrouvés dans le NOM du lot pour rattacher celui-ci
//                  à l'entrée (comparaison sans accents ni casse)
// - motsCles     : termes recherchés dans les LIBELLÉS D'ACTIVITÉS garantis
//                  (attestations) pour juger de l'adéquation
// Le contenu reprend les rapprochements demandés par SPEC §4 et le vocabulaire
// réel des attestations (cf. attestation-eleval-rcd.txt : « monte charge »,
// « portes automatiques », « travaux accessoires de serrurerie-metallerie »...).
export const SYNONYMES_LOTS = {
  'etancheite-couverture': {
    libelle: 'Étanchéité / couverture / bardage',
    synonymes: ['etancheite', 'couverture', 'bardage', 'toiture'],
    motsCles: ['etancheite', 'couverture', 'bardage', 'toiture', 'zinc', 'bitume', 'etancheite liquide', 'membrane', 'EPDM', 'verriere'],
  },
  'electricite': {
    libelle: 'Électricité / courants forts et faibles',
    synonymes: ['electricite', 'courants forts', 'courants faibles', 'courants forts-faibles'],
    motsCles: ['electricite', 'courant fort', 'courant faible', 'courants forts', 'courants faibles', 'tableau electrique', 'TGBT', 'eclairage', 'cablage', 'domotique', 'alarme', 'video'],
  },
  'fermetures-menuiserie-aluminium': {
    libelle: 'Fermetures / menuiserie aluminium',
    synonymes: ['fermetures', 'menuiserie aluminium', 'menuiseries aluminium', 'menuiserie'],
    motsCles: ['fermeture', 'menuiserie', 'aluminium', 'alu', 'volet', 'rideau metallique', 'garde-corps', 'garde corps', 'fenetre', 'baie vitree', 'verriere'],
  },
  'cvc-plomberie-chauffage': {
    libelle: 'CVC / plomberie / chauffage',
    synonymes: ['cvc', 'chauffage', 'froid climatisation'],
    motsCles: ['cvc', 'chauffage', 'climatisation', 'ventilation', 'VMC', 'desenfumage', 'froid', 'aerothermie', 'chaudiere', 'pompes a chaleur', 'eaux chaudes', 'gainable'],
  },
  'plomberie': {
    libelle: 'Plomberie sanitaire',
    synonymes: ['plomberie', 'plomberie sanitaire', 'plombe'],
    motsCles: ['plomberie', 'sanitaire', 'robinetterie', 'appareillage sanitaire', 'eaux usees', 'evacuation', 'alimentation en eau', 'mitigeur'],
  },
  'peinture': {
    libelle: 'Peinture / revêtements',
    synonymes: ['peinture', 'peinture revetements'],
    motsCles: ['peinture', 'revetement', 'enduit', 'faience', 'papier peint', 'antidegradant', 'resine de sol'],
  },
  'ascenseurs': {
    libelle: 'Ascenseurs / monte-charges',
    synonymes: ['ascenseurs', 'ascenseur'],
    motsCles: ['ascenseur', 'monte-charge', 'monte charge', 'monte-personne', 'monte personne', 'escalier mecanique', 'trottoir roulant', 'elevateur', 'EPMR', 'EUP'],
  },
  'photovoltaique': {
    libelle: 'Photovoltaïque',
    synonymes: ['photovoltaique', 'centrale photovoltaique', 'solaire'],
    motsCles: ['photovoltaique', 'panneau solaire', 'solaire', 'ombriere', 'autoconsommation', 'onduleur', 'stockage'],
  },
  'maconnerie': {
    libelle: 'Maçonnerie / gros oeuvre',
    synonymes: ['maconnerie', 'gros oeuvre', 'gros-oeuvre'],
    motsCles: ['maconnerie', 'gros oeuvre', 'beton arme', 'dallage', 'fondation', 'structure beton', 'longrine', 'banche'],
  },
  'serrurerie': {
    libelle: 'Serrurerie / métallerie',
    synonymes: ['serrurerie', 'serrurerie-metallerie', 'metallerie'],
    motsCles: ['serrurerie', 'metallerie', 'porte metallique', 'grille', 'rampe d\'escalier', 'cysteme', 'garde-corps metallique'],
  },
  'portes-automatiques': {
    libelle: 'Portes automatiques',
    synonymes: ['portes automatiques', 'porte automatique'],
    motsCles: ['porte automatique', 'portes automatiques', 'moteur de porte', 'porte sectionnelle', 'porte coupe-feu', 'niveleur de quai', 'equipement de quai', 'porte piétonne'],
  },
  'portes-souples': {
    libelle: 'Portes souples (froid)',
    synonymes: ['portes souples', 'porte souple'],
    motsCles: ['porte souple', 'portes souples', 'rideau souple', 'porte rapide', 'lame souple'],
  },
  'panneaux-froids': {
    libelle: 'Panneaux froids / froid industriel',
    synonymes: ['panneaux froids', 'froid industriel'],
    motsCles: ['panneau froid', 'panneaux froids', 'chambre froide', 'froid positif', 'froid negatif', 'isotherme', 'cellule froide'],
  },
  'ria-sprinkleur': {
    libelle: 'RIA / sprinkleur (SPK)',
    synonymes: ['ria', 'spk', 'sprinkleur', 'sprinklage'],
    motsCles: ['RIA', 'sprinkleur', 'sprinklage', 'sprinkler', 'extinction automatique', 'rete', 'desenfumage'],
  },
  'transformateur': {
    libelle: 'Transformateur / poste de livraison',
    synonymes: ['transformateur', 'poste de livraison', 'ht bt'],
    motsCles: ['transformateur', 'poste de livraison', 'HTA', 'moyenne tension', 'poste de transformation', 'Enedis', 'genie civil de poste'],
  },
  'platrerie-sols': {
    libelle: 'Plâtrerie / sols',
    synonymes: ['platrerie', 'platrerie sols', 'sols'],
    motsCles: ['platrerie', 'cloison', 'plafond suspendu', 'chape', 'carrelage', 'doublage', 'dalle flottante', 'sols'],
  },
};

// NB d'intention pour le lecteur sans contexte :
// - ce fichier ne contient AUCUNE logique : uniquement des données documentées ;
// - les valeurs null sont volontaires (information absente du corpus) et
//   devront être complétées depuis les Kbis/PA réels lors des prochains dossiers.
