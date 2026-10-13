# Modèle de données

Ce document décrit le modèle de données de l'application : les objets, leurs champs
et leur sens, les conventions de saisie et de sérialisation, les règles de calcul et
d'assurance qui s'y rattachent, la persistance et les référentiels. Le contrat
technique de référence est `SPEC.md` (§2 modèle, §3 calculs, §4 assurances, §8
contrats d'export). Le code de référence est dans `js/etat.js`, `js/calculs.js`,
`js/assurances.js` et `js/referentiels.js` ; en cas de doute sur un nom de champ,
c'est `js/etat.js` qui fait foi.

## 1. Conventions transverses

| Convention | Choix | Motif |
|---|---|---|
| Dates | Chaînes **« AAAA-MM-JJ »** (ISO 8601), `null` si inconnue | Canon unique : le tri alphabétique est le tri chronologique, et aucune ambiguïté JJ/MM n'existe entre postes. `importerJSON()` accepte en plus « JJ/MM/AAAA » et convertit. |
| Montants | Nombres JavaScript, en euros, **arrondis à 4 décimales** à l'écriture | Supprime le bruit flottant tout en conservant la précision intermédiaire des calculs. Le moteur n'applique aucun arrondi comptable au centime : cet arrondi relève de l'affichage et des gabarits de sortie. |
| TVA | 20 % par défaut, surchargeable par le paramètre `tvaTaux` | Le taux est un **paramètre** de `montantAvecVariantes` et d'`appliquerProrata`, jamais une constante interne. Exemple : 100 000 HT → TVA 20 000 → TTC 120 000. |
| Inconnus | `null` explicite ; jamais une valeur devinée | Toute valeur non renseignée reste identifiable comme telle. Les pièces portent, lorsqu'il existe, un champ de provenance (`sourcePdf`, `extraction`). |
| Identifiants entreprise | Chaînes stables en minuscules (ex. `'serrurex'`) | Clé de rapprochement entre devis, attestations, ordres de service et avenants. |

> **Note.** `creerProjetVide()` initialise les champs texte de saisie de
> `operation`, `maitreOuvrage` et `equipe` à la chaîne vide `''` (champ « non encore
> saisi »), et non à `null`. Les consommateurs doivent traiter les deux valeurs comme
> « non renseigné ».

### Montant en lettres : deux rendus

- **`montantEnLettres(n)`** : mots en minuscules, centimes inclus si non nuls.
  Exemple : `100000` → « cent mille euros » ; `1234.5` → « mille deux cent
  trente-quatre euros et cinquante centimes ».
- **`montantEnLettresMajuscules(n)`** : forme exigée par le CCAP. Les mots sont en
  MAJUSCULES, suivis de « ET nn CTS » avec les centimes **toujours sur deux chiffres**
  (00 si nuls), puis quatre astérisques. Exemple : `100000` →
  « CENT MILLE EUROS ET 00 CTS**** » ; `1234.5` → « MILLE DEUX CENT TRENTE-QUATRE EUROS
  ET 50 CTS**** ».

La fonction `montantEnLettresMajuscules` est **la source unique** du rendu CCAP : les
générateurs l'utilisent et ne reproduisent jamais ce format, y compris le remplissage.
Le préfixe « Soit en lettres : TTC » appartient à la ligne du gabarit, pas à la
fonction. Les majuscules restent accentuées (« ZÉRO »), conformément à la typographie
française.

## 2. Projet (objet racine, persisté)

Défini dans `js/etat.js` (contrat SPEC §2), avec des extensions documentées :

```js
Projet {
  id,                      // EXTENSION : chaîne, clé IndexedDB (nécessaire à la persistance)
  operation,               // voir §3
  maitreOuvrage,           // voir §4
  agence,                  // copie de AGENCE_PAR_DEFAUT (js/referentiels.js), éditable par projet
  entreprises[],           // Entreprise[] — voir §5
  devis[],                 // Devis[] — voir §6
  attestations[],          // Attestation[] — voir §7
  equipe: { architecteSignataire, conducteursTravaux[] },
  retenueGarantieTaux,     // 0.05 par défaut (5 %)
  penalites: { tauxJournalier, montantMaxPct },  // défauts : 1/3000e par jour, 5 % — paramétrables
  marche: { controleTechnique, sps, geotechnicien, opc },  // intervenants du CCAP — EXTENSION OPTIONNELLE
  crc: { dateReunion, intervenants[], generalites[], sections[], contacts },  // canevas du compte rendu de chantier — EXTENSION OPTIONNELLE
  OS[],                    // OrdreDeService[] — voir §8
  avenants[]               // Avenant[] — voir §9
}
```

`penalites` et `retenueGarantieTaux` ont des valeurs par défaut de paramétrage. Elles
sont écrasées par les valeurs saisies pour chaque marché, qui doivent être vérifiées
dans le CCAP de l'opération.

**Extensions `id`, `marche` et `crc`.** Ces champs ne figurent pas au contrat de base.

- `id` est nécessaire comme clé IndexedDB.
- `marche` et `crc` sont tolérés absents : un projet qui ne les porte pas produit un
  document complet, sans ces intervenants ou ces sections.
- `creerProjetVide()` les crée vides. `marche` porte les quatre intervenants à `null`
  (`controleTechnique`, `sps`, `geotechnicien`, `opc`) ; chaque intervenant saisi est un
  objet libre `{ nom, adresse, tel, email, note }`. `crc` vaut
  `{ dateReunion: null, intervenants: [], generalites: [], sections: [], contacts: {} }`.
- `importerJSON()` complète les clés manquantes, qu'une section soit absente ou
  partielle, sans jamais écraser les données présentes. `dateReunion` est normalisée
  au format canonique `AAAA-MM-JJ`.
- `crc.contacts` est un **objet indexé** par identifiant d'entreprise
  (`{ [entrepriseId]: { tel, email } }`), et non un tableau. Le générateur s'appuie sur
  cette structure telle quelle.

**Un projet porte une seule opération.** Un projet correspond à une opération. Chaque
ordre de service et chaque avenant se rattache à une opération par l'intermédiaire du
projet qui le porte. Le jeu d'exemple `donnees/op-2026-01.json` contient deux
opérations distinctes, identifiées par deux clés (voir §12).

## 3. Operation

```js
Operation { reference, intitule, adresse, cp, ville,
            droc,               // date réglementaire d'ouverture de chantier (AAAA-MM-JJ, null si non saisie)
            dureePrevisionnelleMois,
            coutTravauxHT,      // coût total de construction HT déclaré par le maître d'ouvrage (seuils 26 M€ / 6 M€)
            ouvertureChantier,  // date effective d'ouverture de chantier (annexe I de l'article A. 243-1) — à défaut, controler() présume la DROC et le signale ([info])
            ouvrageSoumis,      // true (art. L. 241-1) | false (art. L. 243-1-1) | null : choisit le seuil de coût applicable
            pc,                 // référence du permis de construire
            faitLe,             // date portée dans « FAIT À / LE » des documents
            lieuFait }          // lieu porté dans « FAIT À » — initialisé depuis l'agence
```

- `coutTravauxHT` inclut les honoraires. Il pilote les seuils d'assurance de 26 M€
  (ouvrages soumis) et de 6 M€ (ouvrages non soumis), SPEC §4.
- `lieuFait` est initialisé depuis `AGENCE_PAR_DEFAUT.lieuFait`. Le « FAIT À » est une
  propriété de l'agence et non de l'opération : il est donc identique pour toutes les
  entreprises d'un même projet.

## 4. MaitreOuvrage / Agence

```js
MaitreOuvrage { raisonSociale, representant, qualiteRepresentant, siren, adresse, cp, ville }
Agence        { raisonSociale, forme, representant, siren, siret, adresse, cp, ville, tel, email, lieuFait }
```

- `AGENCE_PAR_DEFAUT` est **vide** : tous les champs valent `null`, sauf `titreBloc`.
  `titreBloc` vaut « L'agence d'architecture » : c'est la première ligne du bloc agence
  des gabarits, et elle reste paramétrable pour les variantes d'en-tête.
- `lieuFait` est une extension hors du modèle de base. Il porte le « FAIT À » des
  gabarits, et `null` tant que l'utilisateur ne l'a pas saisi.
- L'agence est renseignée à l'écran Configuration. Rien n'est présupposé sur l'agence
  qui utilise l'outil.

## 5. Entreprise

```js
Entreprise { id, raisonSociale, forme, representant, qualiteRepresentant,
             siren, siret, adresse, cp, ville, lotNom, lotNumero }
```

- `lotNom` est le libellé du lot ; `lotNumero` son numéro, lorsqu'il est connu.
- **Extension `tel` / `email`.** Les comptes rendus publient le téléphone et l'e-mail
  de chaque intervenant, champs absents du contrat de base. Ils sont portés par les
  entrées de `ENTREPRISES_EXEMPLE` (`null` si inconnus), afin que le générateur du
  compte rendu n'ait pas à les ressaisir.
- `ENTREPRISES_EXEMPLE` (`js/referentiels.js`) est un jeu d'entreprises **entièrement
  fictives**, utilisé par les tests et la démonstration. Il n'est pas importable depuis
  l'interface.

## 6. Devis

```js
Devis { entrepriseId, numero, date, htBase,
        variantes: [{ libelle, sens: 'plus'|'moins'|'option', ht, retenue }],
        prorata: { mode: 'inclus'|'valeur', taux? },
        sourcePdf,           // pièce source du devis (traçabilité du dépôt)
        delaisRealisation }  // engagement de délais de l'offre retenue (texte libre, ex. « avril à juillet »)
```

- `delaisRealisation` est porté par le devis : c'est l'offre qui engage l'entreprise,
  l'ordre de service ne fait que le reprendre. Il est `null` à la saisie tant qu'il
  n'est pas connu.
- `retenue === true` est la seule condition de prise en compte d'une variante. Le sens
  détermine le signe : `plus` ajoute, `moins` déduit, `option` ajoute lorsqu'elle est
  retenue (une option retenue s'ajoute au HT, comme une plus-value).
- `prorata.mode = 'inclus'` : le HT affiché reste inchangé et le TTC = HT × 1,2 demeure
  le montant de référence.
- `prorata.mode = 'valeur'` avec `taux` (de 0 à 1) : seul le taux appliqué au HT entre
  dans le compte de l'entreprise. Exemple : HT 100 000 et taux 0,5 → HT 50 000,
  TVA 10 000, TTC 60 000.
- Exemple de devis avec variante : `htBase = 100000`, variante `plus` de `10000`
  retenue → 110 000 HT, soit 132 000 TTC.

## 7. Attestation

```js
Attestation { entrepriseId, type: 'RCD'|'RC'|'URSSAF'|'FISCALE'|'TRAVAIL_CACHE'|'KBIS'|'QUALIBAT'|'AUTRE',
              assureur, numeroContrat, valideDu, valideAu,
              activites: [{ code?, libelle }], exclusions: [],
              sourcePdf, extraction: 'texte'|'ocr'|'manuelle' }
```

Produite par `analyserAttestation(texte)` (`js/assurances.js`) à partir du texte
extrait des PDF ou d'une retranscription manuelle. Le parseur prend en charge plusieurs
formats (voir §7.1). Il renseigne en plus les extensions suivantes, toutes `null` ou
absentes lorsqu'elles ne sont pas détectées :

- `assure` : nom de l'assuré, lu dans la formule « certifie que <assuré>, immatriculé(e)
  sous le n° … ». Il permet à l'interface de proposer le rattachement entre entreprise
  et attestation, sans ressaisie.
- `programme` : nom du produit d'assurance (ex. « EDIFICE », « CAP 2000 »). Il fait
  partie de l'identification du contrat.
- `numeroAssure` : numéro d'assuré propre au gabarit SMABTP.
- `sousTraitanceHorsPerimetre` : `true` lorsque la garantie reste acquise aux travaux
  sous-traités **même hors** activités déclarées (gabarit SMABTP) ; `false` lorsque les
  sous-traitants ne sont couverts que dans le cadre des activités visées (gabarit
  Abeille).
- `couvreOuvragesSoumis` : `true` lorsque l'attestation cite l'article L. 241-1 du Code
  des assurances, `false` sinon. Cet indicateur est nécessaire à la règle de seuil de
  coût (voir ci-dessous).
- `plafonds` : limites chiffrées portées par la police, extraites du texte lorsque le
  gabarit les mentionne. Les clés absentes ne sont pas renseignées. Les clés sont :
  - `soumisHT` et `nonSoumisHT` : seuils de coût opposables. Les valeurs réglementaires
    par défaut sont 26 M€ (ouvrages soumis) et 6 M€ (ouvrages non soumis) ; une police
    peut porter une autre valeur, qui est alors extraite ;
  - `bonFonctionnementHT`, `rcCorporels`, `rcMateriels`, `rcImmatériels`,
    `implantation`, `amiante`, `environnement` : plafonds de garantie ;
  - `rcdNonSoumisHT` : plafond de garantie de la RCD des ouvrages non soumis. Il ne
    doit pas être confondu avec `nonSoumisHT`, qui est un seuil de coût de chantier :
    la confusion ferait passer au rouge un chantier garanti.

Extraction par fenêtres contextuelles : « n'est pas supérieur à » (seuil soumis) et
« n'excède pas » (seuil non soumis). Les mentions « franchise » et « par sinistre »
écartent les franchises. Les deux-points immédiatement après un intitulé distinguent
le plafond de la RCD non soumise des plafonds en cas de CCRD.

### Contrôle (`controler`) : trois règles

1. **Déclencheur de couverture.** Le déclencheur légal est l'**ouverture de chantier**
   située dans la période de validité (annexe I de l'article A. 243-1), et non la seule
   DROC. Tant que l'ouverture effective n'est pas saisie, elle est présumée égale à la
   DROC et une raison `[info]` le signale sans dégrader le voyant. Sans DROC non plus,
   l'orange signale une couverture temporelle non vérifiable.
2. **Seuils de coût.** Au-delà du seuil soumis porté par la police (26 M€ par défaut),
   le voyant passe au rouge : la garantie n'est pas acquise sans avenant d'adaptation.
   Entre le seuil non soumis (6 M€) et le seuil soumis, le voyant passe au rouge
   seulement si l'attestation ne couvre que des ouvrages non soumis (aucune référence à
   L. 241-1, ou seul `nonSoumisHT` renseigné). Dans les autres cas, il reste orange. La
   nature soumise ou non soumise de l'ouvrage est portée par `operation.ouvrageSoumis` :
   `true` choisit le seuil soumis, `false` le seuil non soumis, `null` laisse l'incertitude
   déclarée en orange. Si `coutTravauxHT` est `null`, la raison `[info]` « seuil non
   vérifié » est émise et aucune conclusion n'est tirée. Un faux rouge est plus grave
   qu'une incertitude signalée.
3. **Plafonds de garantie.** Ils sont restitués pour l'affichage. Ils ne déclenchent
   jamais le voyant.

Les raisons préfixées « [info] » sont informatives et ne dégradent pas le voyant.

### 7.1 Formats d'attestation reconnus

Deux formats d'attestation décennale sont reconnus. Le parseur est multi-formats : toute
nouvelle formulation s'ajoute comme motif explicite, le repli générique restant en
dernier recours.

| | Abeille IARD & Santé (produit EDIFICE) | SMABTP (produit CAP 2000) |
|---|---|---|
| Libellé de période | « Valable pour la période du … au … » | « Période de validité : du … au … » (les deux formulations sont reconnues, plus un repli générique « du … au … ») |
| Activités | Codes **S839 / S899 / G899** accompagnés de libellés descriptifs | **Liste à puces sans code**, après un titre de section « Périmètre des activités professionnelles garanties » |
| Numéro de contrat | Formule « contrat EDIFICE en vigueur n° … » | Numéro composite (deux segments séparés par « / »), suivi d'un numéro d'assuré |
| Clause de sous-traitance | Travaux accessoires distincts d'un marché à part entière ; sous-traitants couverts dans le cadre des activités visées | « la garantie lui reste acquise même s'ils ne correspondent pas aux activités déclarées ci-dessus » |

Conséquences de conception :

1. **Période.** Au moins deux formulations sont reconnues explicitement.
2. **Activités.** Elles sont extraites avec ou sans codes. Les items de liste à puces
   sont stockés **sans** clé `code` (`code?` est optionnel au contrat). Une majuscule en
   début de ligne sans puce referme la liste, ce qui protège de la phrase suivante.
3. **Adéquation.** Le rapprochement textuel mot-clé ↔ libellé est le chemin principal :
   les `motsCles` de `SYNONYMES_LOTS` sont cherchés dans le texte des activités. Les codes
   Sxxx ne sont qu'un indice supplémentaire.
4. **Provenance.** `extraction` vaut `'texte'`, `'ocr'` ou `'manuelle'`. Lorsque
   l'attestation retenue est `extraction: 'manuelle'`, `controler()` passe le voyant à
   **orange** : une saisie à la main n'a pas la fiabilité d'une extraction automatique.
   L'OCR reste une extraction automatique et n'entraîne pas de déclassement ; l'interface
   doit cependant afficher la provenance à côté du voyant.
5. **Lecture partielle.** `exclusions[]` ne contient que ce qui est détecté dans le texte
   fourni. La première page d'un document seule ne permet pas de conclure à l'absence
   d'exclusion : il faut lire l'ensemble des pages.

Les codes d'activité suivent la nomenclature portée par les attestations (S839
ascenseurs et monte-charges, S899 activités secondaires, G899 ouvrages non soumis à
l'obligation). `exclusions` est une liste de **libellés en français** détectés
(« Sauf … », « À l'exclusion de … », clause « travaux accessoires », limites de coût,
sous-œuvre).

## 8. OrdreDeService (`Projet.OS[]`)

```js
OrdreDeService { entrepriseId, numero, dateDebut, date }
```

- `dateDebut` est la date de début d'exécution (« à compter du »), au format ISO.
- `date` est la date de signature (« LE : »). Elle est distincte de `dateDebut` : un
  ordre de service peut être signé avant la date de démarrage. Cette distinction
  appartient au gabarit ; elle est une extension de données.
- **Dates des classeurs Excel.** Un classeur qui déclare son système de dates 1904
  (attribut `date1904`) stocke les dates comme des numéros de série décalés. Le
  générateur d'ordre de service écrit les dates **dans le système du gabarit**, sans
  quoi chaque date est décalée de plusieurs jours.

## 9. Avenant

```js
Avenant { numero, objet, entrepriseId,
          lignes: [{ libelle, sens: 'plus'|'moins', montant }],  // sens EXPLICITE, prime sur le signe (montants positifs en saisie)
          modificationDelais }   // chaîne (ex. « Néant ») ou null
```

Chaînage financier (contrat SPEC §3) :

```
(A) montant initial du lot à l'acte d'engagement
(B) = (A) + cumul des avenants précédents
(C) montant en plus   (D) montant en moins (positif)
MONTANT CUMULÉ = (B) + (C) − (D)
```

`chainageAvenant()` renvoie `{A, B, C, D, cumule}` **en HT**. Les colonnes TVA et TTC
du gabarit valent `x × tvaTaux` et `x × (1 + tvaTaux)`. Le paramètre `tvaTaux` est validé
mais sans effet sur ce calcul, puisque les lettres (A) à (D) sont déjà HT.

Exemple : montant initial de 500 000 HT, avenant en plus de 20 000 HT, aucun en moins →
(C) 20 000, cumulé 520 000 HT, soit 104 000 de TVA et 624 000 TTC.

## 10. Persistance et échange (`js/etat.js`)

| Fonction | Comportement |
|---|---|
| `creerProjetVide()` | Projet conforme au §2, agence et paramètres pré-remplis, `id` généré (`crypto.randomUUID`, avec repli horodaté) |
| `sauvegarderProjet(projet)` | Écrit dans IndexedDB, base `smt-projets`, magasin `projets`, clé `projet.id`. Hors navigateur, rejet « IndexedDB indisponible hors navigateur » : l'échange passe alors par JSON |
| `chargerProjet(id)` | Lecture par clé ; rejet explicite si le projet est absent |
| `exporterJSON(projet)` | JSON **stable** : clés triées, dates canoniques, aucun objet `Date`, aucun `NaN` ni `Infinity`, indentation de 2 espaces |
| `importerJSON(texte)` | Valide les sections obligatoires (`operation`, `maitreOuvrage`, `agence`), complète les listes par défaut, normalise les dates (`JJ/MM/AAAA` → `AAAA-MM-JJ`) et lève une erreur explicite sur une date non reconnue |

Le stockage passe par un port (`creerStockageIndexedDB`, `creerStockageMemoire`,
`definirStockageParDefaut`). L'adaptateur IndexedDB est celui du navigateur ;
l'adaptateur mémoire sert aux tests Node.

**Vérification.** `node tests/etat.mjs` couvre `creerProjetVide`, `exporterJSON`,
`importerJSON` et le rejet hors navigateur d'IndexedDB. La fumée du socle est aussi
exécutée par `node tests/assurances.mjs`, qui construit les jeux de données du contrôle
d'assurance.

## 11. Référentiels (`js/referentiels.js`)

- `AGENCE_PAR_DEFAUT` : agence vide (voir §4).
- `ENTREPRISES_EXEMPLE` : jeu d'entreprises fictives pour les tests et la démonstration
  (voir §5).
- `TYPES_PIECES` : liste `{ code, libelle, obligatoire, sources }` des pièces
  administratives. Les codes sont KBIS, RCD, RC, URSSAF, FISCALE et RIB (obligatoires),
  puis QUALIBAT, TRAVAIL_CACHE, TRAVAILLEURS_ETRANGERS, CIBTP, PRO_BTP, SUR_HONNEUR,
  NON_CONDAMNATION et AUTRE. Les codes correspondent aux valeurs de `type` de
  `Attestation` lorsqu'elles existent.
- `SYNONYMES_LOTS` : dictionnaire `{ cle: { libelle, synonymes[], motsCles[] } }`.
  `synonymes` rattachent le **nom du lot** à une entrée du dictionnaire ; `motsCles` sont
  recherchés dans les **libellés d'activités garanties** pour scorer l'adéquation (voir
  `adequationActivite`). Les comparaisons ignorent les accents et la casse, et « œ » est
  ramené à « oe ».

## 12. Jeu de données d'exemple

`donnees/op-2026-01.json` est un jeu d'exemple **entièrement fictif** : deux opérations,
une agence, des entreprises d'exemple, des devis, des ordres de service et un avenant.
Il sert aux tests d'intégration et à la démonstration. Son bloc `_meta` documente les
inconnues et les hypothèses retenues. Aucune de ses valeurs ne décrit un chantier
existant, et elles ne doivent pas être utilisées comme référence.
