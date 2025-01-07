// @ts-check
import { XMLBuilder, XMLParser } from "fast-xml-parser";

const api_key = process.env.API_KEY;
const api_url = "https://api.opentransportdata.swiss/ojp2020";
const parser = new XMLParser();

function buildApiRequest(body) {
    return {
        headers: {
            Authorization: "Bearer " + api_key,
            "Content-Type": "application/XML",
        },
        body: buildXMLBody(body),
        method: "POST",
    };
}

function buildXMLBody(body) {
    const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: "_",
    });
    return builder.build({
        OJP: {
            ["_xmlns:xsi"]: "http://www.w3.org/2001/XMLSchema-instance",
            ["_xmlns:xsd"]: "http://www.w3.org/2001/XMLSchema",
            ["_xmlns"]: "http://www.siri.org.uk/siri",
            ["_version"]: "1.0",
            ["_xmlns:ojp"]: "http://www.vdv.de/ojp",
            ["_xsi:schemaLocation"]:
                "http://www.siri.org.uk/siri ../ojp-xsd-v1.0/OJP.xsd",
            OJPRequest: {
                ServiceRequest: {
                    RequestTimestamp: new Date().toISOString(),
                    RequestorRef: process.env.REQUESTOR_REF,
                    ...body,
                },
            },
        },
    });
}

export async function getSingleStopDepartures(stop_code, time, replacements) {
    const request = buildApiRequest({
        "ojp:OJPStopEventRequest": {
            RequestTimestamp: new Date().toISOString(),
            "ojp:Location": {
                "ojp:PlaceRef": {
                    StopPlaceRef: stop_code,
                    // This is mandatory, but it can be any string
                    "ojp:LocationName": {
                        "ojp:Text": "Zürich",
                    },
                },
                "ojp:DepArrTime": time,
            },
            "ojp:Params": {
                "ojp:NumberOfResults": 100,
                "ojp:StopEventType": "departure",
                "ojp:IncludeRealtimeData": true,
                "ojp:IncludePreviousCalls": false,
                "ojp:IncludeOnwardCalls": false,
                "ojp:OperatorFilter": {
                    "ojp:OperatorRef": "Transports Publics Genevois",
                    "ojp:Exclude": false,
                },
            },
        },
    });
    let fetched;
    try {
        fetched = await fetch(api_url, request);
    } catch (error) {
        console.log(`Error fetching data for '${stop_code}'`, error);
        return [];
    }
    const fetched_text = await fetched.text();
    if (!fetched.ok) {
        console.log(
            `API ERROR: [${fetched.status}] ${fetched.statusText}\n${fetched_text}`
        );
        return [];
    }

    const parsed = parser.parse(fetched_text);
    return extractDepartures(parsed, replacements);
}

// time can be undefined for current time
export async function getDepartures(stop_codes, time, replacements) {
    // Query API in parallel for each stop code
    const promises = stop_codes.map(
        async (code) => await getSingleStopDepartures(code, time, replacements)
    );
    const departures = await Promise.all(promises);
    return departures.flat().sort((a, b) => a.time - b.time);
}

export async function getStopCodes(stop_name) {
    const request = buildApiRequest({
        "ojp:OJPLocationInformationRequest": {
            RequestTimestamp: new Date().toISOString(),
            "ojp:InitialInput": {
                "ojp:LocationName": stop_name,
            },
            "ojp:Restrictions": {
                "ojp:Type": "stop",
                "ojp:NumberOfResults": 10,
                "ojp:IncludePtModes": true,
            },
        },
    });
    let fetched;
    try {
        fetched = await fetch(api_url, request);
    } catch (error) {
        console.log(`Error fetching data for '${stop_name}'`, error);
        return [];
    }
    const fetched_text = await fetched.text();
    if (!fetched.ok) {
        console.log(
            `API ERROR: [${fetched.status}] ${fetched.statusText}\n${fetched_text}`
        );
        return [];
    }

    const parsed = parser.parse(fetched_text);
    const stop_codes_raw = extractStopCodes(parsed);
    const stop_codes = [];
    for (const stop of stop_codes_raw) {
        if (
            stop.name === stop_name &&
            !stop_codes.find((s) => s.code === stop.code)
        ) {
            stop_codes.push(stop.code);
        }
    }
    if (stop_codes.length === 0) {
        console.log(`Stop '${stop_name}' not found.`, stop_codes_raw);
    }
    if (stop_codes.length > 1) {
        console.log(`Multiple stops found for '${stop_name}'.`, stop_codes);
    }
    return stop_codes;
}

function extractStopCodes(parsed) {
    let locations_raw =
        parsed["siri:OJP"]["siri:OJPResponse"]["siri:ServiceDelivery"][
            "ojp:OJPLocationInformationDelivery"
        ]["ojp:Location"];
    if (!Array.isArray(locations_raw)) {
        locations_raw = [locations_raw];
    }
    return locations_raw.map((l) => {
        const stop_place = l["ojp:Location"]["ojp:StopPlace"];
        return {
            code: stop_place["ojp:StopPlaceRef"],
            name: stop_place["ojp:StopPlaceName"]["ojp:Text"],
        };
    });
}

function extractDepartures(parsed, replacements) {
    const stop_event_delivery =
        parsed["siri:OJP"]["siri:OJPResponse"]["siri:ServiceDelivery"][
            "ojp:OJPStopEventDelivery"
        ];
    let stop_events_raw = stop_event_delivery["ojp:StopEventResult"];
    const status = stop_event_delivery["siri:Status"];
    if (!status) return [];
    // If the API returns only one stop event, XMLParser will not return an array
    if (!Array.isArray(stop_events_raw)) {
        stop_events_raw = [stop_events_raw];
    }
    const stop_events = stop_events_raw.map((s) => s["ojp:StopEvent"]);
    const now = Date.now();
    return stop_events.map((stop_event) => {
        const service_departure =
            stop_event["ojp:ThisCall"]["ojp:CallAtStop"][
                "ojp:ServiceDeparture"
            ];
        const estimated_time = service_departure["ojp:EstimatedTime"];
        const is_realtime = estimated_time !== undefined;
        const time = new Date(
            estimated_time ?? service_departure["ojp:TimetabledTime"]
        );
        const line =
            stop_event["ojp:Service"]["ojp:PublishedLineName"]["ojp:Text"];
        const destination = replace(
            replacements,
            stop_event["ojp:Service"]["ojp:DestinationText"]["ojp:Text"]
        );
        const not_serviced =
            stop_event["ojp:ThisCall"]["ojp:CallAtStop"]["ojp:NotServicedStop"];
        const waiting_time = (time - now) / 60000;
        return {
            destination,
            line,
            not_serviced,
            time,
            is_realtime,
            waiting_time,
        };
    });
}

export function getLastDate(departures) {
    return departures.reduce((acc, cur) => Math.max(acc, cur.time), -Infinity);
}

export function replace(replacements, str) {
    for (let replacement of replacements) {
        str = str.replace(replacement.match, replacement.replace);
    }
    return str;
}
