filename=$(basename -- "$1")
filename="rapport-${filename%.*}"
node index.js $1 && npx pagedjs-cli  ./out/$filename.html -o ./out/$filename.pdf  --browserArgs --export-tagged-pdf
# --outline-tags h1,h2,h3
