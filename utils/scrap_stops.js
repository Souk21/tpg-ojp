//@ts-check
import fs from "fs/promises";
import HTMLParser from "node-html-parser";
import { getStopCodes } from "../src/api.js";

async function fetchHTML(url) {
    const fetched = await fetch(url, {
        headers: {
            ["Accept"]:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            ["Accept-Encoding"]: "gzip, deflate, br",
            ["Accept-Language"]: "en-US,fr;q=0.8,fr-FR;q=0.5,en;q=0.3",
            ["Cache-Control"]: "no-cache",
            ["Connection"]: "keep-alive",
            ["Cookie"]:
                "visid_incap_419648=dFj4z/4CSUWj0UhnraHC1laPY2UAAAAAQUIPAAAAAAB5lPhRpA6J9qp1WmWKSuvV; Drupal.visitor.tpg_wex_current_url=%2Ffr%2Flignes; visid_incap_626527=3Gf4IJTBSOyjSLHlFpigsu+gQmQAAAAAQUIPAAAAAADUTTSBo7IBjG/SFI1318uO; incap_ses_465_419648=Ib4eNBWe3DVsyINN6wR0BpBJf2UAAAAAtP1yAwoJHGWl8kV/2dLzvg==",
            ["DNT"]: "1",
            ["Host"]: "www.tpg.ch",
            ["Pragma"]: "no-cache",
            ["Sec-Fetch-Dest"]: "document",
            ["Sec-Fetch-Mode"]: "navigate",
            ["Sec-Fetch-Site"]: "same-origin",
            ["Sec-Fetch-User"]: "?1",
            ["TE"]: "trailers",
            ["Upgrade-Insecure-Requests"]: "1",
            ["User-Agent"]:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
        },
    });
    const fetched_text = await fetched.text();
    return HTMLParser.parse(fetched_text);
}

const timestamp = Date.now().toLocaleString("fr-CH");
console.log("Scraping lines...");
const lines_html = await fetchHTML("https://www.tpg.ch/fr/lignes");
const lines = lines_html.querySelectorAll(".lignes a>span").map((l) => {
    const background = l.attributes.style.match(
        /background-color: (#[0-9A-F]{6});/
    )[1];
    return {
        name: l.textContent,
        text_color: l.classList.contains("noir") ? "black" : "white",
        background,
    };
});
console.log(`Found ${lines.length} lines.`);

let stops = [];
for (const line of lines) {
    console.log(`Scraping line '${line.name}' stops...`);
    const line_html = await fetchHTML(
        `https://www.tpg.ch/fr/lignes/${line.name}`
    );
    const this_line_stops = line_html
        .querySelectorAll(".stop__label")
        .map((p) => {
            let content = p.textContent;
            if (content.endsWith(".")) {
                content = content.substring(0, content.length - 1);
            }
            return content;
        });
    stops = [...new Set([...stops, ...this_line_stops])];
}
console.log(`Found ${stops.length} stops.`);

const stops_with_codes = [];

let i = 0;
getCode();

async function getCode() {
    if (i >= stops.length) {
        await finish();
        return;
    }
    const idx = i;
    getStopCodes(stops[idx]).then((codes) => {
        stops_with_codes.push({ name: stops[idx], codes });
    });
    i++;
    // Do not flood the API
    setTimeout(getCode, 1500);
}

async function finish() {
    console.log("Writing files...");
    await fs.writeFile(
        `${timestamp}_lines.json`,
        JSON.stringify(lines, null, 2)
    );
    await fs.writeFile(
        `${timestamp}_stops.json`,
        JSON.stringify(stops_with_codes, null, 2)
    );
    console.log(`Wrote as '${timestamp}'.`);
}
