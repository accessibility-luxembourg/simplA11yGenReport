filename=$(basename -- "$1")
filename="rapport-${filename%.*}"
node index.js $1 && npx pagedjs-cli --outline-tags "h1,h2,h3" ./out/$filename.html -o ./out/$filename.pdf

