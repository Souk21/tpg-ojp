// @ts-check
import { XMLBuilder, XMLParser } from "fast-xml-parser";

const api_key = process.env.API_KEY;
const api_url = "https://api.opentransportdata.swiss/ojp20";
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
            ["_xmlns"]: "http://www.vdv.de/ojp",
            ["_xmlns:siri"]: "http://www.siri.org.uk/siri",
            ["_version"]: "2.0",
            OJPRequest: {
                "siri:ServiceRequest": {
                    "siri:RequestTimestamp": new Date().toISOString(),
                    "siri:RequestorRef": process.env.REQUESTOR_REF,
                    ...body,
                },
            },
        },
    });
}

export async function getSingleStopDepartures(stop_code, time, replacements) {
    const request = buildApiRequest({
        OJPStopEventRequest: {
            "siri:RequestTimestamp": new Date().toISOString(),
            Location: {
                PlaceRef: {
                    "siri:StopPointRef": stop_code,
                    // This is mandatory, but it can be any string
                    Name: {
                        "Text": "",
                    },
                },
                DepArrTime: time,
            },
            Params: {
                NumberOfResults: 100,
                StopEventType: "departure",
                UseRealtimeData: "explanatory",
                IncludePreviousCalls: false,
                IncludeOnwardCalls: false,
                OperatorFilter: {
                    OperatorRef: "Transports Publics Genevois",
                    Exclude: false,
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
            `API ERROR: [${fetched.status}] ${fetched.statusText}\n${fetched_text}`,
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
        async (code) => await getSingleStopDepartures(code, time, replacements),
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
            `API ERROR: [${fetched.status}] ${fetched.statusText}\n${fetched_text}`,
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
        parsed["OJP"]["OJPResponse"]["siri:ServiceDelivery"][
            "OJPStopEventDelivery"
        ];
    let stop_events_raw = stop_event_delivery["StopEventResult"];
    // If the API returns only one stop event, XMLParser will not return an array
    if (!Array.isArray(stop_events_raw)) {
        stop_events_raw = [stop_events_raw];
    }
    const stop_events = stop_events_raw.map((s) => s["StopEvent"]);
    const now = Date.now();
    return stop_events.map((stop_event) => {
        const service_departure =
            stop_event["ThisCall"]["CallAtStop"][
                "ServiceDeparture"
            ];
        const estimated_time = service_departure["EstimatedTime"];
        const is_realtime = estimated_time !== undefined;
        const time = new Date(
            estimated_time ?? service_departure["TimetabledTime"],
        );
        const line =
            stop_event["Service"]["PublishedServiceName"]["Text"];
        const destination = replace(
            replacements,
            stop_event["Service"]["DestinationText"]["Text"],
        );
        const not_serviced =
            stop_event["ThisCall"]["CallAtStop"]["NotServicedStop"];
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
