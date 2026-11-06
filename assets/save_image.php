<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8">
        <title>Poptropica</title>
        <script id="input" type="application/json"><?php echo htmlspecialchars(json_encode($_POST), ENT_HTML401); ?></script>
    </head>
    <body>
        <script>

function main() {
    const data = getJSONData();

    if(data !== null) {
        const width = parseInt(data.width, 10),
              height = parseInt(data.height, 10);

        if(!Number.isNaN(width) && !Number.isNaN(height) && typeof data.img === "string")
            try {
                processImage(width, height, data.img.split(","));
                return;
            } catch(err) { }
    }

    // Invalid data or error
    close();
    setTimeout(open, 500, "/", "_self");
}

function processImage(width, height, strPixels) {
    const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");

    canvas.width = width;
    canvas.height = height;

    const bitmap = ctx.getImageData(0, 0, width, height),
          max = bitmap.width * bitmap.height;

    for(let i = 0, x = 0, y = 0, bi, pixel; i < max; i++) {
        bi = (x + y * bitmap.width) * 4;
        pixel = parseInt(strPixels[i], 16);

        if(Number.isNaN(pixel))
            throw new TypeError("Bad pixel data: " + strPixels[i]);

        bitmap.data[bi] = (pixel >>> 16) & 255;
        bitmap.data[++bi] = (pixel >>> 8) & 255;
        bitmap.data[++bi] = pixel & 255;
        bitmap.data[++bi] = 255;

        if(++y === bitmap.height) {
            y = 0;
            x++;
        }
    }

    ctx.putImageData(bitmap, 0, 0);
    canvas.toBlob(onBlob);
}

function onBlob(blob) {
    location.href = URL.createObjectURL(blob);
}

function getJSONData() {
    try {
        const obj = JSON.parse(document.getElementById("input").innerText);

        if(typeof obj === "object" && obj !== null && !Array.isArray(obj))
            return obj;
    } catch(err) { }

    return null;
}

main();

        </script>
    </body>
</html>