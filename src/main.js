// @ts-check
import fs from "fs/promises";
import ejs from "ejs";
import http from "http";
import path from "path";
import compression from "http-compression";
import { getDepartures, getLastDate } from "./api.js";
import { URLSearchParams } from "url";

const base_path = path.resolve("./templates/");
const port = process.env.PORT || 3000;

const stops_raw = await fs.readFile("./data/stops.json");
const stops = JSON.parse(stops_raw.toString());

const colors_raw = await fs.readFile("./data/colors.json");
const colors = JSON.parse(colors_raw.toString());
const default_color = { text_color: "white", background: "black" };

const row_template = await compileTemplate(`${base_path}/row.ejs`);
const main_template = await compileTemplate(`${base_path}/main.ejs`);

const compressor = compression({});

const server = http.createServer(async (req, res) => {
    compressor(req, res);
    const fav_stops = parseAndSetCookies(req, res);

    let url = req.url;
    if (url === undefined || url === "/") {
        url = "/s/default";
    }
    if (url.startsWith("/s/")) {
        await handleGenericStopRequest(req, res, fav_stops);
    } else if (url.startsWith("/list")) {
        handleListRequest(req, res, stops_raw, fav_stops);
    } else {
        res.statusCode = 404;
        res.end();
    }
});

server.listen(port);
console.log(`Listening on http://localhost:${port}`);

async function handleGenericStopRequest(req, res, fav_stops) {
    // Strip "/s/" from the URL
    let requested_stop = req.url.substring(3);
    let stop = stops.find((s) =>
        s.codes.find((code) => code === requested_stop)
    );
    if (!stop) {
        if (fav_stops.length > 0) {
            // Fallback to first favorite, if any
            stop = fav_stops[0];
        } else {
            // Otherwise, fallback to Cornavin
            stop = stops.find((s) => s.codes[0] === "8587057");
        }
    }
    // Url might include "?time="
    const param_index = requested_stop.indexOf("?");
    if (param_index === -1) {
        // No parameter, so it's a stop request
        await handleStopRequest(stop, res, fav_stops);
    } else {
        const params = requested_stop.substring(param_index);
        await handleMoreResultsRequest(stop, params, res);
    }
}

function handleListRequest(req, res, stops_raw, saved_stops) {
    const data = {
        stops: stops_raw,
        favorites: saved_stops,
        location: "list",
        stop: undefined,
    };
    res.write(main_template(data));
    res.end();
}

async function handleStopRequest(stop, res, saved_stops) {
    let departures = await getDepartures(stop.codes);
    departures = departures.map((d) => {
        d.color = colors[d.line] ?? default_color;
        return d;
    });
    const last_date = getLastDate(departures);
    const data = {
        stop,
        departures,
        favorites: saved_stops,
        last_date,
        location: stop.codes[0],
    };
    res.write(main_template(data));
    res.end();
}

async function compileTemplate(absolute_path) {
    const template = await fs.readFile(absolute_path);
    const template_str = template.toString();
    return ejs.compile(template_str, {
        filename: absolute_path,
    });
}

function parseAndSetCookies(req, res) {
    let cookie = req.headers.cookie;
    if (cookie === undefined) {
        cookie = "fav=";
    }
    // Always set the cookie to ensure it is updated and to hopefully address issues with short expiration times in some browsers
    res.writeHead(200, {
        "Set-Cookie": `${cookie};expires=Fri, 31 Dec 9999 23:59:59 GMT;SameSite=Lax;Path=/`,
    });
    const is_valid_cookie = cookie.startsWith("fav=") && cookie.length > 4;
    const fav_codes = is_valid_cookie ? cookie.substring(4).split(",") : [];
    return fav_codes.map((fav_code) => {
        const found = stops.find((s) => s.codes[0] === fav_code);
        const name = found?.name ?? "???";
        return {
            codes: found?.codes ?? fav_code,
            name,
        };
    });
}

async function handleMoreResultsRequest(stop, param_str, res) {
    const params = new URLSearchParams(param_str);
    const time = params.get("time");
    if (time === null) {
        res.end();
        return;
    }
    let departures = await getDepartures(stop.codes, time);
    departures = departures.map((d) => {
        d.color = colors[d.line] ?? default_color;
        return d;
    });
    let html = "";
    for (let departure of departures) {
        html += row_template({ departure, stop_code: stop.codes[0] });
    }
    const last_date = getLastDate(departures);
    res.write(
        JSON.stringify({
            html,
            last_date,
        })
    );
    res.end();
}
