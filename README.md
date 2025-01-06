# tpg-ojp
A simple client/server meant to display the next departures for TPG *(Transport Publics Genevois)* stops, using the OJP *(Open Journey Planner)* API provided by https://opentransportdata.swiss/

[Try it live](https://tpg.souf.dev/)

## Goals
The main goal of this project is to provide a simple and fast way to check the next departures for a given stop, without having to go through the TPG website or app. The website is mobile-friendly and can be added to the home screen for quick access. It features simple SSG HTML and little javascript on the client to ensure compatibility and accessibility. It is meant to load fast and be light. There's also no tracking, no analytics and no ads.


## Setup
- Create a `.env` file with:
  - `PORT` The port to listen on
  - `API_KEY` Your OJP API key
  - `REQUESTOR_REF`
     > Please note that you must make a unique entry as RequestorRef.
     > The aim here is to identify who is making the enquiry.
     > The specification should include the suffix “_test”, “_int” or “_prod”.
     >
     > (From https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/#Technical_description)
- Launch with `node --env-file .env src/main.js`

## Data
Data in `data/` is generated using `utils/scrap_stops.js`, with some manual adjustments.
- Scrap line names and colors from https://www.tpg.ch/fr/lignes
- Scrap stop names from https://www.tpg.ch/fr/lignes/$line
- Query stop codes from OJP API (LocationInformationRequest)
- Manually verify stops with missing code

## License
MIT