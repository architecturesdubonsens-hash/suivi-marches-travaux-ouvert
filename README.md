# Suivi des Marchés de Travaux

Application web qui chaîne la phase exécution d'une opération de travaux : à partir des **devis retenus** et des
**pièces administratives**, elle produit **sans ressaisie** les quatre livrables d'une agence d'architecture.

| Livrable | Format |
|---|---|
| Marché de Travaux (CCAP NF P 03-001) | .docx |
| Ordre de Service (formulaire A4, 1 feuille par entreprise) | .xlsx |
| Compte Rendu de Chantier n°01 (canevas) | .docx |
| Avenant (fiche + OS avenant) | .xlsx |

**Aucune installation, aucun compte requis.** L'application est un site statique : modules ES natifs, aucune étape de
construction, aucune dépendance à installer. Par défaut, elle fonctionne entièrement dans le navigateur.

## Utilisation

**L'application doit être servie en HTTP.** Ouvrir `index.html` par double-clic **ne fonctionne pas** : les
modules ES natifs sont refusés par le navigateur depuis une origine `file://` (erreur CORS sur `js/app.js`),
et l'écran reste vide. C'est une contrainte du navigateur, pas un défaut de l'outil.

    # en local, pour essayer
    python -m http.server 8777 --bind 127.0.0.1 --directory .

    # puis ouvrir
    http://127.0.0.1:8777/index.html

Le workflow suit quatre écrans : **1. Configuration** (opération, maître d'ouvrage, **votre agence**, équipe) →
**2. Dépôt** (glisser-déposer des devis et pièces administratives, pré-remplissage par lecture du texte des PDF) →
**3. Validation** (variantes cochables, recalcul instantané, voyant d'assurances) → **4. Génération**
(arborescence `01_MARCHES/`, `02_OS/`, `03_CRC/`, `04_SUIVI_AVENANTS/` + `PROJET.json`).

**L'agence est vide au départ** : l'outil ne présuppose rien sur celle qui s'en sert. Renseignez-la une fois à l'écran
Configuration ; elle figure ensuite sur les ordres de service, marchés et comptes rendus.

**Où sont mes données ?** Le dossier est enregistré automatiquement, mais **uniquement dans le navigateur de ce poste**
(IndexedDB) : rien n'est envoyé ailleurs. Vider les données du site, changer d'ordinateur ou ouvrir une fenêtre de
navigation privée le fait perdre. L'application le dit dès l'écran Configuration, où se trouvent aussi les boutons
**Exporter le dossier (JSON)** et **Importer un dossier (JSON)** : l'export sauvegarde le dossier dans un fichier, l'import
le reprend, ici ou sur un autre poste.

## Partager ses dossiers entre postes (facultatif)

Sans configuration, rien ne quitte votre navigateur. Pour retrouver vos dossiers sur plusieurs postes, l'application
sait s'appuyer sur une base **Supabase** :

- **L'inscription est ouverte** : chacun crée son compte (courriel et mot de passe) depuis la barre « Dossier partagé ».
- **Chaque dossier est privé à son créateur.** Personne d'autre ne peut le lire, le modifier, le supprimer ni se
  l'attribuer. Cette garantie est portée **par la base** (politiques RLS de `db/schema.sql`), pas seulement par l'écran.
  Elle se vérifie : `db/test-isolation.sql` rejoue dix contrôles entre deux utilisateurs fictifs, puis annule tout.

Mise en place, une fois :

1. Créer un projet sur [Supabase](https://supabase.com) et noter son adresse et sa clé publique.
2. Exécuter `db/schema.sql` dans l'éditeur SQL du projet.
3. Exécuter `db/test-isolation.sql` : les 10 lignes doivent toutes afficher `ok = true`.
4. Renseigner l'adresse et la clé publique dans `js/config.js`.
5. Authentication → Providers → Email : fournisseur **activé**, et « Allow new users to sign up » **activé**.

**Courriel de confirmation.** Le service de courrier intégré à Supabase est limité (débit et destinataires). Pour
accueillir des utilisateurs extérieurs, configurez votre propre serveur de courrier (SMTP), ou désactivez l'exigence
de confirmation, en sachant alors que n'importe quelle adresse sera acceptée à l'inscription.

La clé publique de `js/config.js` est faite pour être publiée. **Ne mettez jamais ici une clé de service
(`service_role`)** : elle contourne les politiques d'accès.

## Structure

    index.html, css/, js/        application (modules ES natifs, aucune étape de build)
    js/calculs.js                moteur : TVA, prorata, variantes, montants en lettres, chaînage d'avenant
    js/assurances.js             voyant d'assurances : période, activités, exclusions, seuils, plafonds
    js/gen-*.js                  les quatre générateurs (docx, xlsx)
    js/stockage-supabase.js      accès à la base partagée (facultatif)
    gabarits/                    les deux formulaires Excel vides (ordre de service, avenant)
    donnees/op-2026-01.json      jeu de données d'EXEMPLE, entièrement fictif
    db/                          schéma de la base et banc d'isolation
    docs/cahier-des-charges.html le besoin métier
    docs/MODELE-DONNEES.md       les champs, leur sens, leurs règles
    SPEC.md                      le contrat technique : modèle de données, règles, contrats d'export
    vendor/                      docx, ExcelJS, JSZip, pdf.js (aucune installation)

## Tests

    node tests/calculs.mjs        moteur de calcul et rendu des montants en lettres
    node tests/assurances.mjs     analyse des attestations et voyant
    node tests/etat.mjs           modèle de données, export/import JSON
    node tests/gen-xlsx.mjs       ordres de service et avenants (preuves lues dans le XML produit)
    node tests/gen-docx.mjs       marché et compte rendu
    node tests/agence-vide.mjs    les quatre générateurs avec une agence vide (état de départ)
    node tests/integration.mjs    chaîne complète sur le jeu de données d'exemple
    node tests/stockage-supabase.mjs  accès à la base, connexion, création de compte (réseau simulé)
    node tests/sauvegarde.mjs     sauvegarde et restauration de tous les dossiers
    node tests/test-devis.mjs     lecture des devis

Vérifications dans un vrai navigateur (Microsoft Edge, serveur local ci-dessus) :

    node tests/verif-navigateur.mjs http://127.0.0.1:8777/index.html 10000

Aucun `node_modules`, aucune installation : les bibliothèques tierces sont dans `vendor/` et les tests les
chargent par un contexte `vm` (`tests/lib/chargeur-umd.mjs`).

## Pièges connus, payés une fois chacun

- **Format de date.** Un classeur Excel peut déclarer le calendrier 1904 : la série 44259 y vaut le 05/03/2025, et
  non le 25/02/2025 comme le laisse croire l'époque Windows. Vérifier `date1904` dans `xl/workbook.xml`.
- **Format d'affichage.** Une date juste peut s'afficher à l'américaine (`mm-dd-yy`) : vérifier le format, pas
  seulement la valeur.
- **Vérifier l'artefact, pas le retour du module.** Les tests relisent le XML des fichiers produits : c'est la
  seule preuve de ce qu'Excel et Word afficheront.
- **Un test avec une agence renseignée ne voit pas ce qui arrive à un nouvel utilisateur.** L'application démarre avec
  une agence vide ; `tests/agence-vide.mjs` vérifie qu'aucun gabarit ne porte l'identité de quelqu'un d'autre et
  qu'aucun champ vide n'est rendu littéralement (« undefined », « null ») dans un document destiné à être signé.
- **`fetch` appelé comme méthode d'un objet.** `courante.fetchImpl(url)` donne à `fetch` un `this` qui n'est pas
  la fenêtre, et le navigateur refuse l'appel : « Illegal invocation ». La connexion réussissait, puis **toute**
  opération sur la base échouait. Invisible aux tests, qui passent un `fetch` simulé acceptant n'importe quel `this`.
  Appeler `fetch` sans receveur (helper `appeler`), et tester avec un `fetch` qui refuse un `this` étranger
  (`fetchStrict` dans `tests/stockage-supabase.mjs`).
- **Un essai qui ne va pas jusqu'au bout ne prouve rien.** Vérifier le chemin de réussite, pas seulement le refus.
- **Un banc se prouve rouge avant d'être vert.** `db/test-isolation.sql` détecte une fuite : remplacez
  temporairement les quatre politiques par `using (true)` et rejouez-le, des lignes passent à `ok = false`.

## Déploiement

L'application se déploie **telle quelle** : site statique, aucune étape de construction. `.vercelignore` décide de ce
qui est publié : `index.html`, `css/`, `js/`, `vendor/` et les deux gabarits vides ; le reste (données d'exemple,
base, documentation, tests) reste dans le dépôt, hors publication.

`vercel.json` ajoute des en-têtes qui demandent aux moteurs de recherche de ne pas indexer le site
(`X-Robots-Tag: noindex`). Retirez-les si vous souhaitez que votre instance soit référencée.

## Licence

Aucune licence n'est encore déclarée : sans fichier `LICENSE`, tous les droits sont réservés. Ajoutez-en une avant
de laisser des tiers réutiliser ce code.
