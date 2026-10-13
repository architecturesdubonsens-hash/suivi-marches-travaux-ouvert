// valide-syntaxe.mjs — script DOMESTIQUE de validation, volontairement
// HORS du dépôt : le dossier tests/ est la et des
// autres agents. Recette du brief : une SyntaxError = échec ; toute autre
// erreur d'exécution au chargement (ReferenceError document/window attendu
// hors navigateur) = SYNTAXE VALIDE.
//
// Usage : node valide-syntaxe.mjs <file-url-1> <file-url-2> ...

let echecs = 0;
for (const cible of process.argv.slice(2)) {
  try {
    await import(cible);
    console.log("syntaxe OK   " + cible);
  } catch (erreur) {
    if (erreur instanceof SyntaxError) {
      console.error("SYNTAXE      " + cible + " -> " + erreur.message);
      echecs++;
    } else {
      console.log("syntaxe OK   " + cible + " (chargement arrêté tôt : "
        + erreur.constructor.name + " : " + erreur.message + ")");
    }
  }
}
process.exit(echecs ? 1 : 0);

