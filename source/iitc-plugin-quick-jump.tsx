// spell-checker: ignore bottomleft moveend
import { coordinateOfImage } from "./coordinate-of-image";
import { addStyle, waitElementLoaded } from "./document-extensions";
import { lonLatToAddress } from "./gsi-reverse-geocoder";
import { AsyncOptions, cancelToReject, sleep } from "./standard-extensions";
import { imageFileToDataUrl } from "./image-file-to-data-url";

const L = window.L;

function handleAsyncError(promise: Promise<void>) {
    promise.catch((error) => console.error(error));
}

const namespace = "iitc-plugin-quick-jump";
const Names = Object.freeze({
    hidden: `${namespace}-hidden`,
    searchBar: `${namespace}-search-bar`,
    terminal: `${namespace}-terminal`,
    outputList: `${namespace}-output-list`,
    crossHair: `${namespace}-cross-hair`,
    toastList: `${namespace}-toast-list`,
    toastItem: `${namespace}-toast-item`,
    dropZone: `${namespace}-drop-zone`,
    dragOver: `${namespace}-drag-over`,
    mainPinPopup: `${namespace}-main-pin-popup`,
});

const css = `
    .${Names.terminal} {
        width: 100%;
    }
    .${Names.searchBar} {
        background: rgba(8, 48, 78, 0.9);
        border: 1px solid #20A8B1;
    }
    .${Names.searchBar} input {
        width: 100%;
    }
    .${Names.crossHair} {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 3000;

        font-size: 24px;
        font-family: sans-serif;
        color: #FFF;
        text-shadow: 0 0 0.3em #000, 0 0 0.5em #000;
        filter: drop-shadow(0 0 0.5em #000);
    }
    .${Names.hidden} {
        display: none;
    }
    .${Names.toastList} {
        list-style: none;
        padding: 0;
    }
    .${Names.toastItem}:first-of-type {
        border-top: 1px solid #ddd;
    }
    .${Names.toastItem} {
        background-color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        border-top: 1px dashed #ccc;
        margin: 0 0.5em;
        padding: 0.1em;
        box-shadow: 0 2px 2px rgb(0 0 0 / 50%);
    }
    .${Names.toastItem} > input {
        width: 100%;
        color: #444;
        background: rgba(0 0 0 / 0%);
    }
    .${Names.dropZone} {
        background: white;
        padding: 0.5rem;
        border-radius: 0.3rem;
        box-shadow: 0 0 0.5rem black;
    }
    .${Names.dragOver} {
        background: #ddd;
    }
    .${Names.mainPinPopup} {
        text-align: center;
    }
`;

async function searchCoordinate(
    searchText: string,
    _option?: Readonly<AsyncOptions>
) {
    const match = searchText.match(
        /(?<latitude>\d+(\.\d*)?)(\s+|\s*,\s*)(?<longitude>\d+(\.\d*)?)/
    );
    const latitude = match?.groups?.["latitude"];
    const longitude = match?.groups?.["longitude"];
    if (!latitude || !longitude) {
        return null;
    }

    return { lat: parseFloat(latitude), lng: parseFloat(longitude) };
}
interface Settings {
    /** ????????? */
    readonly inputWaitInterval: number;
    /** ????????? */
    readonly locationUpdateWaitInterval: number;
}

let itemCount = 0;
function put(
    { outputList }: Terminal,
    message: string,
    { removeDeray = 5000, maxCount = 5 } = {}
) {
    const item = (
        <li class={Names.toastItem}>
            <input value={message} />
        </li>
    );
    outputList.append(item);
    itemCount++;
    handleAsyncError(
        (async () => {
            await sleep(removeDeray);
            if (maxCount < itemCount) {
                outputList.firstElementChild?.remove();
                itemCount--;
            }
        })()
    );
}
async function moveTo(
    terminal: Terminal,
    coordinate: Readonly<{ lat: number; lng: number }>
) {
    terminal.mainPinPopup.setContent(
        <div class={Names.mainPinPopup}>
            {coordinate.lat}, {coordinate.lng}
        </div>
    );
    terminal.mainPin
        .setOpacity(1)
        .setLatLng(coordinate)
        .setPopupContent(`${coordinate.lat}, ${coordinate.lng}`);
    terminal.put(`${coordinate.lat}, ${coordinate.lng} ????????????????????????`);
    terminal.parentMap.setView(coordinate);
}

interface WaitOptions extends AsyncOptions {
    inputWaitInterval?: number;
}
async function waitAndExecuteCommand(
    terminal: Terminal,
    options?: Readonly<WaitOptions>
) {
    const { searchInput } = terminal;

    // ???????????????????????????
    await sleep(
        options?.inputWaitInterval ?? terminal.inputWaitInterval,
        options
    );

    // ???????????????????????????????????????????????????????????????
    const { value } = searchInput;
    return executeCommand(terminal, value, options);
}
async function executeCommand(
    terminal: Terminal,
    value: string,
    options?: Readonly<AsyncOptions>
) {
    const coordinate = await searchCoordinate(value, options);

    if (!coordinate) {
        return put(terminal, `${value} ?????????????????????????????????????????????`);
    }

    // ???????????????????????????????????????
    await moveTo(terminal, coordinate);
}
function createAsyncCancelScope() {
    let lastCancel = new AbortController();
    return (process: (signal: AbortSignal) => Promise<void>) => {
        // ??????????????????????????????
        lastCancel.abort();
        lastCancel = new AbortController();
        handleAsyncError(
            // ????????????????????????????????????
            cancelToReject(process(lastCancel.signal))
        );
    };
}
class Terminal extends L.Control {
    parentMap!: L.Map;
    searchInput!: HTMLInputElement;
    crossHair!: HTMLElement;
    outputList!: HTMLElement;
    mainPin!: L.Marker;
    mainPinPopup!: L.Popup;
    inputWaitInterval!: number;
    locationUpdateWaitInterval!: number;

    constructor(
        options: L.ControlOptions,
        public settings: Readonly<Settings>
    ) {
        super(options);
    }
    override onAdd(parentMap: L.Map) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const terminal = this;
        const settings = this.settings;
        this.inputWaitInterval = settings.inputWaitInterval;
        this.locationUpdateWaitInterval = settings.locationUpdateWaitInterval;

        const searchInput = (<input></input>) as HTMLInputElement;
        const outputList = <ul class={Names.toastList}></ul>;
        const searchBar = <div class={Names.searchBar}>{searchInput}</div>;
        const crossHair = <div class={Names.crossHair}>???</div>;
        const terminalElement = (
            <div class={Names.terminal}>
                {outputList}
                {searchBar}
                {crossHair}
            </div>
        );
        terminalElement.classList.add(Names.hidden);

        this.parentMap = parentMap;
        this.searchInput = searchInput;
        this.crossHair = crossHair;
        this.outputList = outputList;
        this.mainPinPopup = L.popup();
        this.mainPin = L.marker([0, 0], {
            opacity: 0,
        })
            .addTo(parentMap)
            .on("click", () => {
                this.mainPinPopup
                    .setLatLng(this.mainPin.getLatLng())
                    .openOn(this.parentMap);
            });

        const searchBarHandler = createAsyncCancelScope();
        function startSearch(inputWaitInterval: number) {
            searchBarHandler((signal) =>
                waitAndExecuteCommand(terminal, { inputWaitInterval, signal })
            );
        }

        // ????????????????????? Ctrl + Q ??????????????????????????????????????????????????????????????????
        document.addEventListener("keyup", (e) => {
            if (e.key === "q" && e.ctrlKey) {
                terminalElement.classList.remove(Names.hidden);
                searchInput.focus();
                searchInput.select();
            }
        });
        searchBar.addEventListener("keyup", (e) => {
            switch (e.key) {
                // ??????????????? Esc ??????????????????????????????
                case "Escape": {
                    terminalElement.classList.add(Names.hidden);
                    break;
                }
                // ??????????????? Enter ?????????????????????????????????????????????
                case "Enter": {
                    startSearch(100);
                    break;
                }
            }
        });

        // ???????????????????????????????????????????????????????????????????????????
        searchInput.addEventListener("input", () => {
            startSearch(this.inputWaitInterval);
        });

        // ??????????????????????????????????????????????????????????????????
        const locationAsyncScope = createAsyncCancelScope();
        parentMap.addEventListener("moveend", () => {
            locationAsyncScope(async (signal) => {
                // ???????????????
                await sleep(this.locationUpdateWaitInterval, { signal });

                // ????????????????????????????????????????????? ( ?????????????????? )
                const { lng, lat } = parentMap.getCenter();
                const address = await lonLatToAddress(lng, lat, { signal });

                // ??????
                if (!address) {
                    return put(
                        terminal,
                        `${lng}, ${lat}: ?????????????????????????????????????????????`
                    );
                }
                const { lv01Nm, detail } = address;
                const [, kenName, , shiName] = detail;
                put(terminal, `${lat}, ${lng}`);
                put(terminal, `${kenName}, ${shiName}, ${lv01Nm}`);
            });
        });
        return terminalElement;
    }
    put(message: string, options?: Parameters<typeof put>[2]) {
        put(this, message, options);
    }
}
async function processDroppedFiles(
    e: DragEvent,
    terminal: Terminal,
    { signal }: Readonly<{ signal: AbortSignal }>
) {
    // ???????????????????????????????????????????????????????????????

    const file0 = e.dataTransfer?.files?.[0];
    if (file0 === undefined) {
        return terminal.put("???????????????????????????????????????????????????");
    }

    terminal.put(`?????????????????????????????????????????? ( ${file0.name} )`);
    let coordinate;
    try {
        coordinate = await coordinateOfImage(file0, { signal });
    } catch (e) {
        return terminal.put(`??????????????????????????????????????????( ${file0.name} )`);
    }
    await moveTo(terminal, coordinate);

    // ???????????????????????????????????????????????????????????????????????????
    let iconUrl;
    try {
        iconUrl = await imageFileToDataUrl(file0, {
            signal,
            maxWidth: 48,
            maxHeight: 48,
        });
    } catch (e) {
        // ????????????????????????????????????
        if (e instanceof Error && e.message.includes("Unsupported MIME type")) {
            console.debug(`${e.message}: ${file0.name}`);
        } else {
            throw e;
        }
    }
    if (iconUrl) {
        terminal.mainPinPopup.setContent(
            <div class={Names.mainPinPopup}>
                <img src={iconUrl} title={file0.name} />
                <div>
                    {coordinate.lat}, {coordinate.lng}
                </div>
            </div>
        );
    }
}

function createDropZone(parentMap: L.Map, terminal: Terminal) {
    const fileInput = <input type="file" name="file" />;
    const dropZone = <div class={Names.dropZone}>{fileInput}</div>;
    dropZone.addEventListener(
        "dragover",
        function (e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.add(Names.dragOver);
        },
        false
    );
    dropZone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove(Names.dragOver);
    });

    const fileDropScope = createAsyncCancelScope();
    dropZone.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove(Names.dragOver);

        fileDropScope((signal) => processDroppedFiles(e, terminal, { signal }));
    });
    return dropZone;
}
class DropZone extends L.Control {
    constructor(private _terminal: Terminal, options: L.ControlOptions) {
        super(options);
    }
    override onAdd(parentMap: L.Map) {
        return createDropZone(parentMap, this._terminal);
    }
}
async function asyncMain() {
    await waitElementLoaded();

    if (window.map == null) {
        console.error("map ????????????????????????????????????");
        return;
    }
    L.Icon.Default.imagePath = "https://unpkg.com/leaflet@1.3.1/dist/images/";
    addStyle(css);

    const terminal = new Terminal(
        { position: "bottomleft" },
        {
            inputWaitInterval: 3000,
            locationUpdateWaitInterval: 3000,
        }
    ).addTo(window.map);

    new DropZone(terminal, { position: "bottomleft" }).addTo(window.map);
}
export function main() {
    handleAsyncError(asyncMain());
}
