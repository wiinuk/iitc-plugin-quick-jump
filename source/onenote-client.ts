// spell-checker: ignore msal onenote
import * as msal from "@azure/msal-browser";
import * as graph from "@microsoft/microsoft-graph-client";
import type {
    Entity,
    Notebook,
    OnenotePage,
    OnenotePatchContentCommand,
    OnenoteSection,
} from "@microsoft/microsoft-graph-types";
import { AuthCodeMSALBrowserAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/authCodeMsalBrowser";
import { error } from "./standard-extensions";
import "isomorphic-fetch";

const tenantId = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";
const clientId = "86ec585c-6c79-4892-87db-99af7d9bf9cc";
const scope = "Notes.ReadWrite";

interface AsyncStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
}
interface LoginOptions {
    /**
     * 2回目以降のログインを省くためのユーザー情報の保管庫。
     * 規定では localStorage を使用する。
     */
    persistentStorage?: AsyncStorage;
}
function getLocalStorageStorage(): AsyncStorage {
    return {
        getItem(key: string) {
            return Promise.resolve(localStorage.getItem(key));
        },
        setItem(key: string, value: string) {
            return Promise.resolve(localStorage.setItem(key, value));
        },
    };
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

async function loginSsoOrPopupCore(
    client: msal.PublicClientApplication,
    scopes: string[]
) {
    return await client.loginPopup({
        scopes,
        redirectUri: "http://localhost:3000/blank.html",
    });
}
function loginSsoOrPopup(
    client: msal.PublicClientApplication,
    scopes: string[],
    getLoginButton: () => HTMLElement,
    options?: Readonly<LoginOptions>
) {
    return new Promise<msal.AuthenticationResult>((resolve, reject) => {
        const button = getLoginButton();
        button.append("Login");
        button.addEventListener("click", () =>
            loginSsoOrPopupCore(client, scopes).then(resolve, reject)
        );
    });
}
export async function createAndLoginOneNoteClient(
    getLoginButton: () => HTMLElement,
    options?: Readonly<LoginOptions>
) {
    const scopes: typeof scope[] = [scope];
    const client = new msal.PublicClientApplication({
        auth: {
            clientId,
            authority: `https://login.microsoftonline.com/${tenantId}`,
        },
        cache: {
            cacheLocation: "localStorage",
        },
    });
    await loginSsoOrPopup(client, scopes, getLoginButton, options);
    const [account = error`アカウントが存在しません`] = client.getAllAccounts();

    const authProvider = new AuthCodeMSALBrowserAuthenticationProvider(client, {
        account,
        interactionType: msal.InteractionType.Popup,
        scopes,
    });
    const graphClient = graph.Client.initWithMiddleware({ authProvider });
    return new OneNoteClient(graphClient);
}
type WithId<T extends Entity> = T & Required<Pick<Entity, "id">>;
class OneNoteClient {
    private readonly _root = "me/onenote/";
    constructor(private readonly _client: graph.Client) {}
    private _api(path: string) {
        return this._client.api(this._root + path);
    }

    notebooks(): Promise<WithId<Notebook>[]> {
        return this._api("notebooks").get();
    }
    notebook(id: string): Promise<WithId<Notebook>> {
        return this._api(`notebooks/${id}`).query({ includeIDs: "true" }).get();
    }
    /**
     * ノートブックの名前は一意でなければならない。
     * ノートブックの名前は 128 文字以内でなければならない。
     * ノートブックの名前に ?/*:<>|'" を含めることはできない。
     */
    createNotebook(displayName: string): Promise<WithId<Notebook>> {
        return this._api("notebooks").post({ displayName });
    }
    sectionsInNotebook(notebookId: string): Promise<WithId<OnenoteSection>[]> {
        return this._api(`notebooks/${notebookId}/sections`).get();
    }
    section(id: string): Promise<OnenoteSection> {
        return this._api(`sections/${id}`).get();
    }
    createSectionInNotebook(
        notebookId: string,
        displayName: string
    ): Promise<WithId<OnenoteSection>> {
        return this._api(`notebooks/${notebookId}/sections`).post({
            displayName,
        });
    }
    pagesInSection(sectionId: string): Promise<WithId<OnenotePage>[]> {
        return this._api(`sections/${sectionId}/pages`).get();
    }
    page(pageId: string): Promise<OnenotePage> {
        return this._api(`pages/${pageId}`).get();
    }
    private _xmlSerializerCache: XMLSerializer | null = null;
    private get _xmlSerializer() {
        return (this._xmlSerializerCache ??= new XMLSerializer());
    }
    createPageInSection(
        sectionId: string,
        rawHtmlOrDocument: string | Document
    ): Promise<OnenotePage> {
        const rawHtml =
            typeof rawHtmlOrDocument === "string"
                ? rawHtmlOrDocument
                : this._xmlSerializer.serializeToString(rawHtmlOrDocument);
        return this._api(`sections/${sectionId}/pages`)
            .header("Content-type", "application/xhtml+xml")
            .post(rawHtml);
    }
    updatePage(
        pageId: string,
        commands: readonly OnenotePatchContentCommand[]
    ): Promise<void> {
        return this._api(`pages/${pageId}`).patch(commands);
    }
    removePage(pageId: string): Promise<void> {
        return this._api(`pages/${pageId}`).delete();
    }
}
