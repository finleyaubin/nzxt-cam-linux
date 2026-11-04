# Contribuer à nzxt-cam-linux

Merci de l'intérêt pour le projet. nzxt-cam-linux est gratuit, open-source, et le restera toujours.

## Comment contribuer

### Signaler un bug
Ouvre une [issue GitHub](https://github.com/cypherxdev77/nzxt-cam-linux/issues/new) en décrivant :
- Le comportement observé vs attendu
- Ton modèle de Kraken (PID si possible : `lsusb | grep 1e71`)
- Ta distro et version du kernel

### Proposer une fonctionnalité
Ouvre une issue avec le tag `enhancement`. Décris le besoin et pourquoi ça serait utile à d'autres utilisateurs.

### Soumettre du code
1. Fork le repo
2. Crée une branche : `git checkout -b ma-feature`
3. Commit tes changements
4. Ouvre une Pull Request sur `main`

Pour les changements USB/protocole, teste sur un vrai device si possible et documente les résultats.

### Tester sur d'autres modèles

Les modèles testés sur un vrai device sont le Kraken Elite V2 (2024, `0x3012`) et le Kraken 2023 Elite (`0x300c`).

Les PIDs suivants sont dans le code mais non testés :

| Modèle | PID |
|--------|-----|
| NZXT Kraken Elite 360 | `0x3009` |
| NZXT Kraken Elite RGB 360 | `0x300e` |

Si tu as un de ces modèles, ouvre une issue pour dire si ça fonctionne ou non.
