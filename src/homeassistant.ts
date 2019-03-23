import * as ha from "home-assistant-js-websocket";
import { config } from "./configuration";
import { CompletionItem } from "vscode";
import * as vscode from 'vscode';
import * as s from "./socket";
import { ConnectionOptions } from "./socket"; 
import * as ws from "ws"

const WebSocket = require("ws");

export class HomeAssistant {

    private connection: ha.Connection | undefined;
    private hassEntities!: Promise<ha.HassEntities>;
    private hassServices!: Promise<ha.HassServices>;

    private async ensureConnection(): Promise<void> {

        let hasConfig = await config.hasConfigOrAsk();
        if (!hasConfig) {
            let message = `Cannot connect to Home Assistant: not configured`;
            vscode.window.showErrorMessage(message);
            throw new Error(message);
        }

        if (this.connection) {
            return;
        }

        let auth = new ha.Auth(<ha.AuthData>{
            access_token: config.haToken,
            expires: +new Date(new Date().getTime() + 1e11),
            hassUrl: config.haUrl,
            clientId: "",
            expires_in: +new Date(new Date().getTime() + 1e11),
            refresh_token: ""
        }); 
        var options = <ConnectionOptions>{
            WebSocket: WebSocket,
            auth: auth, 
            setupRetry: 1
        };
        try {
            console.log("Connecting to Home Assistant...");
            this.connection = await ha.createConnection({
                auth,
                createSocket: async () => s.createSocket(options)
            });
        }
        catch (error) {
            this.handleConnectionError(error);
            throw error;
        }

        this.connection.addEventListener("ready", () => {
            console.log("Connected to Home Assistant");
        });

        this.connection.addEventListener("disconnected", () => {
            console.log("Lost connection with Home Assistant");
        });
    }

    private handleConnectionError = (error: any) => {
        this.connection = undefined;
        var tokenIndication = `${config.haToken}`.substring(0, 5);
        var errorText = error;
        switch (error) {
            case 1:
                errorText = "ERR_CANNOT_CONNECT";
                break;
            case 2:
                errorText = "ERR_INVALID_AUTH";
                break;
            case 3:
                errorText = "ERR_CONNECTION_LOST";
                break;
            case 4:
                errorText = "ERR_HASS_HOST_REQUIRED";
                break;
        }
        let message = `Error connecting to your Home Assistant Server at ${config.haUrl} and token '${tokenIndication}...', check your network or update your VS Code Settings, make sure to (also) check your workspace settings! Error: ${errorText}`;
        vscode.window.showErrorMessage(message);
        console.error(message);
    }

    private getHassEntities = async (): Promise<ha.HassEntities> => {
        await this.ensureConnection();

        if (!this.hassEntities) {
            this.hassEntities = new Promise<ha.HassEntities>(async (resolve, reject) => {
                if (!this.connection) {
                    return reject();
                }
                ha.subscribeEntities(this.connection, entities => {
                    console.log(`Got ${Object.keys(entities).length} entities from Home Assistant`);
                    return resolve(entities);
                });
            });
        }
        return await this.hassEntities;
    }

    private getHassServices = async (): Promise<ha.HassServices> => {
        await this.ensureConnection();

        if (!this.hassServices) {
            this.hassServices = new Promise<ha.HassServices>(async (resolve, reject) => {
                if (!this.connection) {
                    return reject();
                }
                ha.subscribeServices(this.connection, services => {
                    console.log(`Got ${Object.keys(services).length} services from Home Assistant`);
                    return resolve(services);
                });
            });
        }
        return await this.hassServices;
    }

    public async getEntityCompletions(): Promise<HomeAssistantCompletionItem[]> {

        let entities = await this.getHassEntities();

        if (!entities) {
            return [];
        }

        let completions: HomeAssistantCompletionItem[] = [];

        for (const [key, value] of Object.entries(entities)) {
            let completionItem = new HomeAssistantCompletionItem(`${value.entity_id}`, vscode.CompletionItemKind.EnumMember);
            completionItem.filterText = ` ${value.entity_id}`; // enable a leading space
            completionItem.insertText = completionItem.filterText;

            completionItem.documentation = new vscode.MarkdownString(`**${value.entity_id}** \r\n \r\n`);
            if (value.state) {
                completionItem.documentation.appendMarkdown(`State: ${value.state} \r\n \r\n`);
            }
            completionItem.documentation.appendMarkdown(`| Attribute | Value | \r\n`);
            completionItem.documentation.appendMarkdown(`| :---- | :---- | \r\n`);

            for (const [attrKey, attrValue] of Object.entries(value.attributes)) {
                completionItem.documentation.appendMarkdown(`| ${attrKey} | ${attrValue} | \r\n`);
            }
            completions.push(completionItem);
        }
        return completions;
    }

    public async getServiceCompletions(): Promise<HomeAssistantCompletionItem[]> {

        let services = await this.getHassServices();

        if (!services) {
            return [];
        }

        let completions: HomeAssistantCompletionItem[] = [];

        for (const [domainKey, domainValue] of Object.entries(services)) {
            for (const [serviceKey, serviceValue] of Object.entries(domainValue)) {
                let completionItem = new HomeAssistantCompletionItem(`${domainKey}.${serviceKey}`, vscode.CompletionItemKind.EnumMember);
                completionItem.filterText = ` ${domainKey}.${serviceKey}`; // enable a leading space
                completionItem.insertText = completionItem.filterText;

                var fields = Object.entries(serviceValue.fields);

                if (fields.length > 0) {
                    completionItem.documentation = new vscode.MarkdownString(`**${domainKey}.${serviceKey}:** \r\n \r\n`);
                    completionItem.documentation.appendMarkdown(`| Field | Description | Example | \r\n`);
                    completionItem.documentation.appendMarkdown(`| :---- | :---- | :---- | \r\n`);

                    for (const [fieldKey, fieldValue] of fields) {
                        completionItem.documentation.appendMarkdown(`| ${fieldKey} | ${fieldValue.description} |  ${fieldValue.example} | \r\n`);
                    }
                }
                completions.push(completionItem);
            }
        }

        return completions;
    }

    public disconnect() {
        console.log(`Disconnecting from Home Assistant`);

        if (!this.connection) {
            return;
        }
        this.connection.close();
        this.connection = undefined;
    }
}

export class HomeAssistantCompletionItem extends CompletionItem {
} 