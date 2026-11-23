#!/usr/bin/env bash
set -euo pipefail

html_only=0

if [[ ${1:-} == --html-only ]]; then
    html_only=1
    shift
fi

if [[ $# -ne 1 ]]; then
    echo 'Argument manquant ou incorrect : indiquez un seul fichier JSON d’audit.' >&2
    echo 'Usage: ./run.sh [--html-only] "in/audit.json"' >&2
    echo 'Pour tous les audits du dossier in/ : ./genAll.sh' >&2
    exit 2
fi

input=$1

if [[ $input != /* && ! $input =~ ^[A-Za-z]:[\\/] ]]; then
    input="$PWD/$input"
fi

if [[ ! -f "$input" || ! -r "$input" ]]; then
    echo "Fichier d’audit absent ou illisible : $input" >&2
    echo 'Vérifiez le chemin et utilisez des guillemets si le nom contient des espaces.' >&2
    exit 2
fi

cd -- "$(dirname -- "$0")"
mkdir -p in data out

if ! command -v node >/dev/null 2>&1; then
    echo 'Node.js 22 ou plus récent est requis. Installez Node.js avec npm, puis rouvrez le terminal.' >&2
    exit 2
fi

if ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; then
    echo 'Node.js 22 ou plus récent est requis. Installez Node.js avec npm, puis rouvrez le terminal.' >&2
    exit 2
fi

# Integration tests reuse the current setup and never run nested tests.
if [[ ${GENREPORT_TEST_RUN:-0} != 1 ]]; then
    chmod +x run.sh genAll.sh

    if [[ $html_only -eq 1 ]]; then
        node setup.js
    else
        node setup.js --pdf
    fi
fi

echo 'Checking audit and statement...'
node index.js "$input" --check-only

if [[ $html_only -eq 1 ]]; then
    node index.js "$input" --html-only
else
    node index.js "$input" --pdf
fi