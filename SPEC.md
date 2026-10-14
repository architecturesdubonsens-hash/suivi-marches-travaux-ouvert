# Suivi des Marchés de Travaux — Spécification d'implémentation

**Contrat métier** : `docs/cahier-des-charges.html`. Ce fichier est le **contrat technique** entre développeurs : modèle de données, règles de calcul, contrats d'export des modules.

## 0. Objet

Application web statique qui chaîne la phase exécution d'une opération de travaux (DET / VISA / OPC) : à partir des devis retenus et des pièces administratives, produire sans ressaisie les 4 livrables de l'agence d'architecture.

## 1. Les 4 livrables chaînés

| Livrable | Format | Produit par |
|---|---|---|
| Marché de Travaux (MT) — CCAP NF P 03-001, 13 articles | .docx | `js/gen-marche.js` |
| Ordre de Service (OS) — formulaire A4, 1 feuille/entreprise | .xlsx | `js/gen-os.js` (gabarit `gabarits/os-gabarit.xlsx`) |
| Compte Rendu CRC n°01 (canevas) | .docx | `js/gen-crc.js` |
| Avenant (fiche AV n°x + OS avenant) | .xlsx | `js/gen-avenant.js` (gabarit `gabarits/avenant-gabarit.xlsx`) |

Workflow : **1. Configuration projet** → **2. Dépôt devis + pièces** (glisser-déposer) → **3. Validation** (montants, variantes cochables, voyant assurances) → **4. Génération 1-clic** :
`01_MARCHES/` (un .docx par lot), `02_OS/` (classeur multi-feuilles), `03_CRC/` (CRC-01.docx), `04_SUIVI_AVENANTS/` (fiches AV), `PROJET.json` (état exportable).

## 2. Modèle de données (CONTRAT — ne pas diverger)

Défini dans `js/etat.js`, types en JSDoc (pas de TypeScript). Champs du modèle :

```js
Agence        { raisonSociale, forme, representant, siren, siret, adresse, cp, ville, tel, email, titreBloc }
MaitreOuvrage { raisonSociale, representant, qualiteRepresentant, siren, adresse, cp, ville }
lieuFait, coutTravauxHT, ouvertureChantier, ouvrageSoumis }
                // pcDelivreLe : date de délivrance du permis de construire (page 1, libellé « Délivré le »),
                //   AAAA-MM-JJ comme droc et faitLe ; null si inconnue — jamais la date du jour, jamais inventée.
                //   Ajouté le 14/10/2026 à la demande de l'utilisateur ; n'alimente aucun document généré.
                // ouvertureChantier : date réelle d'ouverture de chantier (annexe I, art. A. 243-1). À défaut,
                //   controler() présume la DROC et le DIT dans une raison [info] qui ne dégrade pas le voyant.
                // ouvrageSoumis : true (art. L. 241-1) | false (art. L. 243-1-1) | null si inconnu. Il choisit
                //   le seuil de coût applicable : 26 M€ si true, 6 M€ si false, vigilance orange entre les deux si null.
lotNom, lotNumero, etat }
                // etat : 'pressentie' | 'consultee' | 'devis_recu' | 'marche_arrete' | null (inconnu).
                //   Étape du dossier, saisie à la main : elle dit ce qui est SU, pas ce qui est complet.
taux?}, sourcePdf, delaisRealisation }
                // delaisRealisation : engagement de l'OFFRE retenue (texte libre, ex. « avril à juillet 2025 »),
Montant       { ht, tva, ttc }                          // tva = 20 % par défaut, surchargeable
Attestation   { entrepriseId, type:'RCD'|'RC'|'URSSAF'|'FISCALE'|'TRAVAIL_CACHE'|'KBIS'|'QUALIBAT'|'AUTRE', assureur,
                numeroContrat, valideDu, valideAu, activites:[{code?, libelle}], exclusions:[], sourcePdf,
                extraction:'texte'|'ocr'|'manuelle' }
                numeroAssure, sousTraitanceHorsPerimetre, couvreOuvragesSoumis,
                // couvreOuvragesSoumis : le texte de l'attestation se réfère-t-il à l'article L. 241-1 ?
                implantation?, amiante?, environnement?, rcdNonSoumisHT? } }
                // rcdNonSoumisHT : PLAFOND de garantie (3 M€/sinistre), à ne pas confondre avec nonSoumisHT qui est
                //   un SEUIL DE COÛT de chantier (6 M€). Deux notions, deux champs : les confondre ferait
                //   basculer un voyant au rouge pour un chantier parfaitement garanti.
Avenant       { numero, objet, entrepriseId, lignes:[{libelle, sens:'plus'|'moins', montant}], modificationDelais|null }
                // Cycle de vie de la pièce (SPEC §6 quater) : id, nomFichier, sha256,
                // statut:'actif'|'remplace', remplacePar, remplaceLe, motifRemplacement.
                // Les mêmes champs valent pour Attestation : un devis et une attestation sont des PIÈCES,
                // et une pièce remplacée n'est jamais effacée.
                // sens est EXPLICITE : il prime sur le signe du montant, que l'interface saisit positif.
Projet        { operation, maitreOuvrage, agence, entreprises[], devis[], attestations[],
                equipe:{architecteSignataire, conducteursTravaux[]}, retenueGarantieTaux:0.05,
OS:[{entrepriseId, numero, dateDebut}]

Extensions OPTIONNELLES du modele, consommées par les générateurs DOCX — tolerees si absentes,
jamais requises : un projet qui ne les porte pas doit produire un document complet sans elles.
  projet.crc     { dateReunion, intervenants[], generalites[], sections[],
                   contacts: { [entrepriseId]: { tel, email } } }   // objet INDEXÉ, pas un tableau
  projet.marche  { controleTechnique, sps, geotechnicien, opc }                          // intervenants du CCAP

Deux champs ajoutés le 25/09/2026 APRÈS lecture du scan SMABTP, parce que sans eux deux règles
légales mesurées ne peuvent pas s'exécuter : coutTravauxHT (seuils opposables 26 M€ / 6 M€) et
Attestation.plafonds (limites de garantie à restituer au maître d'ouvrage).

Extensions ADDITIVES (optionnelles, aucune rupture du contrat) :
  Projet.id ; OS[].date (date de signature, distincte du « A compter du ») ;
  Agence.lieuFait (lieu du « FAIT A ») ; Entreprise.tel et Entreprise.email
  (consommés par le tableau des intervenants du CRC) ; Attestation.assure et
  Attestation.programme (« EDIFICE », « CAP 2000 »…) qui identifient le gabarit d'assurance.
```

⚠️ Le classeur OS réel porte **deux opérations distinctes sous une même référence** (OP-2026-01 : SAS DISTRIBEX / Supermarche Villeneuve-exemple ; S.C.I. DU MODELE / DESAMIA, réfection couverture + photovoltaïque Hautmont-test). Chaque OS et chaque avenant se rattache à **une opération**, pas seulement à un projet.

## 3. Règles de calcul (js/calculs.js — pur, sans DOM)

- **TVA** 20 % par défaut. Exemples de référence : 560 000 → 112 000 → 672 000 ; 97 133,57 → 116 560,284 (TTC = HT × 1,20).
- **Prorata** : « PRO RATA INCLUS » porte sur le HT affiché dans l'OS ; le montant de référence reste le TTC.
- **Variantes** : plus/moins-values et options cochables → HT net → TTC → **retranscription en toutes lettres** pour le CCAP.
- **Montant en lettres (francais)** : `montantEnLettres(n)` rend les mots complets, en minuscules, centimes
  inclus s ils sont non nuls (« cinq cent soixante mille euros », « un euro », « zero euro »).
  **Rendu CCAP exige par le gabarit reel de l agence** : le .doc porte textuellement
  « Soit en lettres : TTC SIX CENT SOIXANTE MILLE EUROS ET 00 CTS**** » — majuscules, « ET nn CTS »
  sur deux chiffres (00 si nul), remplissage d asterisques. Un second export,
  `montantEnLettresMajuscules(n)`, rend cette forme et devient la SOURCE UNIQUE : les generateurs
  l utilisent des qu il est present, sans jamais le reimplementer de leur cote.
- **(A) montant initial** : c'est le HT retenu du devis (montantAvecVariantes, prorata appliqué). Aucun champ
  dédié au contrat : la règle est ici, et le générateur ne la réinvente pas.

- **Chaînage d'avenant (exact du gabarit)** : (A) montant initial à l'acte d'engagement ; (B) = A + cumul des avenants précédents ; (C) montant en plus ; (D) montant en moins ; **cumulé = B + C − D**.
- **Retenue de garantie** 5 % (paramétrable), **pénalités** taux journalier plafonné, **situations mensuelles au 25**.

## 4. Contrôle assurances (js/assurances.js)

- `analyserAttestation(texte)` → période (« Valable pour la période du ... au ... »), assureur, n° contrat, activités garanties (**S839** ascenseur/monte-charge/escalier mécanique ; **S899** activités secondaires : portes automatiques, équipements de quai…), exclusions (« Sauf ... », « à l'exclusion de ... », limites de surface).
- `adequationActivite(lot, activites)` → score de rapprochement texte lot ↔ activités, via dictionnaire de synonymes (étanchéité/couverture ; électricité/courants forts-faibles ; fermetures/menuiserie-aluminium ; CVC/plomberie-chauffage ; peinture ; ascenseurs ; photovoltaïque…).
- `controler(projet, entrepriseId)` → `{voyant:'vert'|'orange'|'rouge', raisons:[]}` — **rouge** : RCD absente, période ne couvrant pas la DROC, aucun match d'activité, exclusion touchant le poste ; **orange** : expiration avant la fin prévisionnelle, adéquation faible.
- **Déclencheur légal (mesuré sur le gabarit SMABTP réel)** : c'est l'**ouverture de chantier** qui doit tomber
  dans la période de validité (annexe I de l'article A. 243-1 du code des assurances), et non la seule DROC.
- **Seuils de coût opposables** : 26 000 000 € de coût total de construction HT (honoraires compris) pour les
  ouvrages soumis à l'obligation ; **6 000 000 €** pour les ouvrages non soumis. Au-delà du second seuil, la
  garantie ne s'applique pas faute d'avenant d'adaptation : le voyant doit pouvoir passer au ROUGE sur le
  seul montant du chantier, sans autre motif.
- **Plafonds chiffrés à restituer** (gabarit SMABTP) : non soumis 3 M€/sinistre ; bon fonctionnement 2,5 M€
  sur 2 ans ; RC 8 M€ corporels, 2 M€ matériels, 1 M€ immatériels ; erreur d'implantation 200 k€ ; amiante et
  environnement 1 M€/sinistre et par an.
- Fondement à afficher : art. L. 241-1 Code des assurances ; clause « travaux accessoires ≠ marché à part entière ».

## 5. Structure des documents produits

**OS** (~147 lignes/feuille, 1 feuille/entreprise) : bloc MO (l.1–9), bloc ENTREPRISE (l.10–15), « ORDRE DE SERVICE À L'ENTREPRENEUR N°1 », LOT + TTC + HT « PRO RATA INCLUS » + « devis numéro X du date » + « A compter du », avertissement forclusion 15 jours, FAIT À / LE + signatures (MO : raison sociale + représentant ; agence : « L'agence d'architecture / S.A.R.L. EXEMPLE ARCHITECTURE / Représentée par Camille Exemple »), ACCUSÉ DE RÉCEPTION.
**Sources exactes des deux cellules de date de l'OS** — tranché le 25/09/2026 après un échec du test
d'intégration sur les données réelles :
  `C42` (« LE: ») = série 1904 de la date de l'ordre de service, soit **`OS[].date`** ; à défaut
  `operation.faitLe` ; si les deux manquent, cellule VIDE (jamais la date du jour, jamais une date inventée).
  `C41` (« FAIT À: ») = `operation.lieuFait`, à défaut `agence.lieuFait`.

⚠️ **Dates en série 1904 (Mac)** — vérifié sur le gabarit : `xl/workbook.xml` porte `date1904="1"`.
44259 = **05/03/2025**, 44281 = **27/03/2025**, 44313 = **28/04/2025**. Recoupement décisif : la même
feuille porte « devis numéro 22041 v2 du 5/3/25 » en face de la série 44259 — la date du devis et la
date d'effet coïncident, ce qui confirme le calendrier 1904. Conserver ce système à l'injection.

**AVENANT** : en-tête (objet, MO, titulaire, lot), tableau **HT | TVA 20 % | TTC**, (A) montant initial, avenants précédents, (B) total rectifié, § 1 « OBJET : PV » → (C), § 2 « OBJET : MV » → (D), **MONTANT CUMULÉ = (B) + (C) − (D)**, § 3 délais (« Néant »), § 4 clause de survie, « Lu et approuvé », **page 2 = OS AVENANT**.

**MT** : en-tête MARCHE TRAVAUX PRIVÉS / Modèle CCAP ; 1.1 OBJET ; N.B. rétractation (art. L. 231-4, L. 271-1/2 CCH) ; désignation des parties (MO, architecte MOE, entrepreneur) ; contrôle technique / SPS / géotechnicien / OPC ; documents constituant le marché (ordre de prévalence, 13 pièces) ; sous-traitance (art. 4.4 CCAG, AR + 15 jours) ; représentation ; RDV de chantier ; comptes-rendus. Le reste des 13 articles est dans le .doc → extraction intégrale vers `docs/corpus/mt-texte-integral.txt`.

**CRC** : canevas CRC n°01 = tableau consolidé des intervenants (MO, agence, BET, SPS, géotechnicien, entreprises par lot — tél/email/présence), généralités administratives, sous-sections par lot (suivi des pièces administratives et visas). Sections du CRC réel : « Bâtiment SUPERMARCHE », « BOUTIQUES / RETAIL », « ETUDES », chaque point attribué (« -> groupe Exemple », « -> DISTRIBEX »…).

## 6. Architecture technique

- **Statique, sans build, sans node_modules** ; ES modules natifs ; dépendances **vendored** dans `vendor/` : docx.umd.js 8.5.0, exceljs.min.js 4.4.0, jszip.min.js 3.10.1, pdf.min.js + pdf.worker.min.js.
- **docx** : `window.docx` chargé à la demande (pattern `app-v3/bc-template.js`).
- **xlsx haute fidélité** : **ExcelJS** sur le gabarit réel (charger → écrire les cellules → exporter) : préserve styles et mise en page A4.
- **PDF** : pdf.js (couche texte, environ 58 % des pièces) ; sinon OCR **tesseract.js** à la demande (CDN, fra, dégradation gracieuse → saisie manuelle assistée).
- **Persistance** : IndexedDB par projet + **export/import JSON** (transfert multi-postes, sans serveur).
- **Sortie finale** : JSZip → arborescence 01–04 + PROJET.json.
- **Habillage** : charte de la maison, portée par `css/tokens.css` (jetons pétrole / ardoise / crème,
  plus les statuts conforme, attention, alerte, info). `css/app.css` ne contient AUCUNE couleur en dur :
  il consomme les jetons. Fond de page crème, bandeau d'en-tête ardoise avec un filet de signature en
  pétrole, actions en ardoise, et le nom de la charte n'apparaît nulle part dans l'interface.
- **Langue** : français intégral (UI, commentaires, docs).

## 6 bis. Exécution réelle dans un navigateur — obligatoire avant toute livraison

L'application est servie en **HTTP**, jamais ouverte par double-clic : les modules ES sont bloqués en
`file://` (le navigateur refuse `js/app.js` avec une erreur CORS, origine `null`) et l'écran reste vide.
C'est une contrainte de déploiement, pas un défaut : Vercel, un serveur local, ou tout hébergement statique.

Vérification : `node tests/verif-navigateur.mjs http://127.0.0.1:8777/index.html 10000`, après
`python -m http.server 8777 --bind 127.0.0.1 --directory <dépôt>`. L'outil pilote le navigateur par le
protocole CDP, **attend en temps réel**, puis lit l'état : nombre d'étapes rendues, indicateur de
sauvegarde, longueur du premier écran, et toute exception ou erreur console.

**Leçon de méthode, payée une fois** : `msedge --dump-dom` capture l'état au chargement et ne dit rien
d'un démarrage asynchrone. Il a fait conclure à tort que le démarrage se bloquait sur un import de
module, alors que l'application démarre et rend son premier écran. Un outil de mesure doit attendre ce
qu'il mesure — même discipline que pour les dates : vérifier la valeur ne prouve pas l'affichage.

## 6 ter. Saisie progressive — la réalité du chantier

**Constat de l'agence (25/09/2026)** : au moment d'émettre les ordres de service, toutes les entreprises
retenues ne sont pas connues — souvent seules celles du clos couvert le sont. L'outil doit donc travailler
sur un dossier **incomplet**, et se compléter au rythme des marchés arrêtés. Un outil qui exige un dossier
complet avant de produire quoi que ce soit ne serait pas utilisé.

1. **Ajout à tout moment.** Une entreprise peut être créée avec le minimum connu et complétée plus tard.
   Aucune liste n'est figée ; l'ordre de saisie n'a aucune importance.
2. **Génération non bloquante.** L'émission d'un OS est **par entreprise**. Une entreprise incomplète ne
   doit JAMAIS empêcher d'émettre l'OS d'une entreprise prête. C'est la règle centrale de cette section.
3. **Complétude explicite.** `etatEntreprise(projet, entrepriseId)` (js/etat.js) rend
   `{ osPret, crcPret, manquants[] }`. L'interface affiche « en attente » **avec la liste de ce qui
   manque** au lieu de refuser en silence.
4. **Ce qu'exige un OS prêt** : raison sociale, lot, un devis retenu avec ses montants, et une date
   d'ordre de service (`OS[].date`) ou de démarrage. Le reste — SIREN, adresse, représentant — peut
   manquer : l'OS sort alors avec les lignes vides du gabarit, **jamais avec une valeur inventée**.
5. **Le CRC est le document vivant du chantier.** Il liste TOUTES les entreprises connues, y compris
celles dont les données sont partielles — **cellules réellement VIDES**, et non des pointillés : l'agence
   a dit « on peut avoir les lignes en blanc ». Jamais de tiret, jamais « inconnu », jamais une valeur
   inventée. Une seule tolérance de pointillés : les champs à remplir À LA MAIN en réunion (« Prochaine
   réunion : le … »), qui sont des invites d'écriture et non des substituts de données. Il comporte une
   section des
   **lots restant à attribuer**. Il se régénère à chaque nouvel arbitrage ; son numéro suit l'ordre des
   réunions (CRC n°01, n°02…). Une entreprise ajoutée après coup apparaît dans le CRC suivant.
6. **Mémoire.** L'état est persisté (IndexedDB) et exportable en JSON : une saisie commencée un jour se
   reprend le lendemain, et un dossier peut passer d'un poste à l'autre sans ressaisie.

## 6 quater. Édition indépendante, remplacement de pièce, et port de stockage

**Question de l'utilisateur (25/09/2026)** : « On peut éditer les pièces et les lots indépendamment les uns
des autres ? Si une modification de dernière minute intervient, on peut approvisionner un nouveau devis
qui remplace l'ancien ? Pour l'instant on a une moulinette dans laquelle on fait passer les pièces, plus
tard il faudra intégrer une base de données. »

1. **Édition indépendante.** Chaque entreprise, chaque lot, chaque devis et chaque pièce s'édite POUR
   LUI-MÊME. Modifier un lot ne doit jamais obliger à ressaisir un devis, une attestation ou un autre lot.
   Toute écriture passe par une clé stable (identifiant d'entreprise, identifiant de pièce) et jamais par
   le remplacement global d'une liste.
2. **Chaque pièce a une identité.** Un `id` stable, et pour un fichier déposé son `nomFichier` et son
   empreinte `sha256` : c'est ce qui permet de remplacer une pièce sans confondre deux versions, de
   savoir qu'un document n'a pas bougé, et plus tard de dédupliquer en base.
3. **Un devis n'est jamais écrasé.** Le nouveau prend le statut `actif`, l'ancien passe à `remplace` avec
   `remplaceLe` et, si l'architecte le saisit, `motifRemplacement` et `remplacePar`. **Les documents
   générés utilisent TOUJOURS le devis actif.** L'historique reste lisible : un chiffre figurant dans un
   document déjà émis doit pouvoir être expliqué six mois plus tard.
4. **Avant ou après le marché : deux gestes différents.** Un devis remplacé AVANT la signature donne un
   nouveau devis actif. APRÈS la signature, la modification ne passe pas par un devis mais par un
   **AVENANT** (la fonction existe). Confondre les deux ferait perdre la trace contractuelle : c'est la
   distinction qui protège l'agence. **Un nouvel upload de devis sur un lot au marché signé ne produit JAMAIS
   un avenant automatiquement** : un avenant modifie un contrat signé, il se négocie et se signe. L'outil
   PRÉPARE, l'architecte décide. L'outil détecte la situation et propose DEUX chemins, en demandant lequel :
   - **« Erreur de saisie dans l'outil »** : la donnée est corrigée, aucun avenant n'est créé — mais l'écart
     avec le document signé est SIGNALÉ, car le marché papier porte toujours l'ancien montant ;
   - **« Travaux modificatifs »** : un avenant est PRÉ-REMPLI — l'écart HT/TVA/TTC entre le nouveau devis et le
     devis actif devient la ligne (plus-value ou moins-value), l'objet du devis devient l'objet de l'avenant —
     puis reste à valider, compléter et faire signer.
   Détection : marcheSigne(projet, entrepriseId) est vrai si l'entreprise porte etat === 'marche_arrete' OU si
   un ordre de service existe pour elle (un OS suit la signature).
   distinction qui protège l'agence.
5. **Port de stockage.** La persistance passe par une interface — `charger`, `sauvegarder`, `lister`,
   `supprimer` — dont l'implémentation actuelle est IndexedDB. Le jour où l'agence dispose d'une base de
   données (Supabase/Postgres), on écrit un SECOND adaptateur : ni les générateurs ni l'interface ne
   changent. Le **format d'export JSON est la représentation d'échange** : c'est le futur schéma de la
   base et le chemin de migration (exporter d'IndexedDB, importer en base).

## 6 quinquies. Persistance partagée — la base de données

**Décision du 25/09/2026, sur réponse de l'utilisateur** : le dossier sera ouvert depuis **au moins trois**
postes (PC du domicile, Mac du bureau, mobile). Le stockage du navigateur est cloisonné par navigateur et par
adresse : trois postes produiraient trois dossiers divergents, sans moyen de savoir lequel fait foi. La base
devient donc la **source de vérité**, et le navigateur n'est plus qu'un **cache de travail**.

1. **Le port de stockage existant reçoit un troisième adaptateur** (SPEC §6 quater) : les générateurs et
   l'interface ne changent pas d'une ligne. IndexedDB reste le cache local, la base porte la vérité.
2. **Sécurité : la clé publique est publiée.** L'application se déploie sur une URL publique et embarque sa
   clé d'accès ; cette clé doit donc ne RIEN pouvoir faire seule. La table est fermée aux anonymes et
   réservée aux utilisateurs **authentifiés** de l'agence (RLS, cf. `db/schema.sql`). Un accès sans
   authentification n'est pas une option à retarder : c'est la condition de la mise en ligne.
3. **Conflits : jamais d'écrasement silencieux.** Chaque dossier porte un numéro de version, et l'écriture
   est conditionnelle (identifiant **et** version). Si un autre poste a écrit entre-temps, l'application
   **conserve la version locale**, signale le conflit et laisse l'architecte trancher. Perdre la saisie de
   quelqu'un sans le lui dire est le seul défaut inacceptable ici.
4. **Hors ligne : l'application reste utilisable.** On travaille dans le cache local, les modifications non
   poussées sont **marquées comme telles** dans l'interface, et la synchronisation se fait à la reconnexion.
   Une non-synchronisation ne se masque jamais : c'est exactement l'erreur qui a fait afficher « Enregistré à
   14 h 54 » pendant que la relecture cherchait ailleurs.
5. **Migration.** Le format exporté par l'application (`exporterJSON`) est le format stocké : les dossiers
   déjà saisis dans un navigateur s'envoient vers la base avec le bouton d'export existant. Aucune ressaisie.

## 7. Tests (Node 24 présent, sans npm ni navigateur)

Chargement des UMD via `node:vm` — utilitaire partagé `tests/lib/chargeur-umd.mjs` :
`chargerUMD(chemin, nomGlobal)` lit le fichier, l'évalue dans un contexte vm (`window`, `self`, `module`, `exports`, `console` injectés), renvoie l'objet global exporté.
- `tests/calculs.mjs` : TVA, variantes, prorata, montants en lettres, chaînage d'avenant (jeux de valeurs de référence).
- `tests/gen-xlsx.mjs` : génère OS + AV depuis `donnees/op-2026-01.json`, relit avec ExcelJS (UMD), asserte cellules clés et conservation des feuilles.
- `tests/gen-docx.mjs` : génère MT + CRC, dézippe (JSZip), asserte `word/document.xml` (13 articles, montant en lettres, tableau intervenants).
- `tests/assurances.mjs` : `analyserAttestation` sur un texte d'attestation reconstitué (S839/S899, période 01/01–31/12/2025, exclusion attendue).

## 8. Contrats d'export (imports croisés — engagements verbaux stricts)

Chaque module importe les autres **uniquement** par ces symboles :

```js
// js/calculs.js
export function montantAvecVariantes(devis, {tvaTaux = 0.2} = {})   // -> {ht, tva, ttc}
export function appliquerProrata(ht, prorata, {tvaTaux = 0.2} = {})  // -> {ht, tva, ttc}
    // Le taux est un PARAMÈTRE, jamais une constante interne : un lot à prorata « valeur » et à taux
    // particulier produirait sinon un TTC faux, sans que rien ne le signale. Défaut 0,2 par convention.
export function montantEnLettres(n)                                 // -> string
export function chainageAvenant({montantInitial, avenantsPrecedents, plusValue, moinsValue, tvaTaux})
    // avenantsPrecedents : LISTE number[] (effet net HT de chaque avenant antérieur) ou {montant}[].
    // JAMAIS un cumul déjà sommé par l appelant : la règle (A)+(1)+(2)+(x) = (B) appartient à
    // ce module seul. Un appelant qui pré-somme duplique la seule règle qui ne doit jamais
    // diverger entre la fiche d avenant et le marché.
    // -> {A, B, C, D, cumule}
export function retenueGarantie(montant, taux = 0.05)               // -> number
export function penalites({montantMarche, jours, tauxJournalier, plafondPct}) // -> number

// js/etat.js
export function creerProjetVide()                                   // -> Projet
export function chargerProjet(id)                                   // -> Promise<Projet>   (IndexedDB)
export function sauvegarderProjet(projet)                           // -> Promise<void>
export function exporterJSON(projet)                                // -> string
export function importerJSON(texte)                                 // -> Projet

// js/referentiels.js
export const AGENCE_PAR_DEFAUT                                      // agence VIDE : chaque utilisateur renseigne la sienne
export const ENTREPRISES_EXEMPLE                                    // entreprises d'EXEMPLE, toutes fictives (tests et démonstration)
export const TYPES_PIECES                                           // liste des pièces administratives attendues
export const SYNONYMES_LOTS                                         // dictionnaire lot -> mots-clés d'activité

// js/assurances.js
export function analyserAttestation(texte)                          // -> Attestation
export function adequationActivite(lot, activites)                  // -> {score, matches[]}
export function controler(projet, entrepriseId)                     // -> {voyant, raisons[]}

// js/gen-os.js      export function genererOS(projet, entrepriseId)   // -> Promise<Blob>
// js/gen-avenant.js export function genererAvenant(projet, entrepriseId, avenant) // -> Promise<Blob>
// js/gen-marche.js  export function genererMarche(projet, entrepriseId)          // -> Promise<Blob>
// js/gen-crc.js     export function genererCRC01(projet)                         // -> Promise<Blob>
```

Les générateurs sont responsables de leur propre chargement asynchrone de `vendor/` (via `<script>` dynamique en navigateur ; via `chargerUMD` en test Node).
