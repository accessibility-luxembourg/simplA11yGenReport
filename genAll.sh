#!/usr/bin/env bash
set -euo pipefail

for option in "$@"; do
    case "$option" in
        --html-only|--check-only)
            ;;
        *)
            echo 'Usage: ./genAll.sh [--html-only] [--check-only]' >&2
            exit 2
            ;;
    esac
done

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
    pdf_needed=1

    for option in "$@"; do
        case "$option" in
            --html-only|--check-only)
                pdf_needed=0
                ;;
        esac
    done

    if [[ $pdf_needed -eq 1 ]]; then
        node setup.js --pdf
    else
        node setup.js
    fi
fi

echo 'Checking all audits and statements...'
node index.js --batch --check-only

for option in "$@"; do
    if [[ $option == --check-only ]]; then
        exit 0
    fi
done

node index.js --batch --pdf "$@"