import {
    getUserFromUserId,
    getAvatarIconUrlFromUserId,
    getDataUrlFromWebResource,
    RobloxWWWRegex,
    RobloxLoginRegex,
    RobloxPresenceRegex,
    removeValueFromArray
} from './utils/utility.ts'

/**
 * Globals
 */

const CONFIG = {
    DETACHED_DEBUGGER_ALERT_DELAY: 10000,
    RETRY_REQUESTS_DELAY: 5000,
    USER_PRESENCE_COOLDOWN: 15000,
    MAXIMUM_USER_PRESENCE_IN_SINGLE_REQUEST: 3
}

const state = {
    shouldReattach: false,
    isAttached: false,
    isAttaching: false,
    attachedTabId: 0,
    recentPresences: [] as string[]
};

/**
 * Feature Toggling
 */

function toggleRulesets(enable: boolean, rulesetIds: Array<string>) {
    chrome.declarativeNetRequest.updateEnabledRulesets({ [enable ? 'enableRulesetIds' : 'disableRulesetIds']: rulesetIds })
}

function toggleRules(enable: boolean, ruleIds: Array<number>, rulesetId: string) {
    chrome.declarativeNetRequest.updateStaticRules({ rulesetId, [enable ? 'enableRuleIds' : 'disableRuleIds']: ruleIds })
}

const features: FeatureMap = {
    enableFriendActivityTracker: toggleTracker,
    enableFriendCarouselExtension: (enable) => toggleRulesets(enable, ['ruleset_FriendCarouselExtension']),
    enableAvatarHeadshotURLRedirect: (enable) => toggleRulesets(enable, ['ruleset_AvatarHeadshotURLRedirect']),
    enableUnfriendBlocker: (enable) => toggleRules(enable, [1], 'ruleset_XhrBlocker'),
    enableLogoutBlocker: (enable) => toggleRules(enable, [2], 'ruleset_XhrBlocker')
};

/**
 * Initialization
 */

(async () => {
    const settings = await chrome.storage.sync.get(Object.keys(features))
    // Sync user settings
    Object.entries(features).forEach(([key, handler]) => handler(!!settings[key]))
    // Listen for changes
    if (!chrome.storage.sync.onChanged.hasListener(listenForChanges)) {
        chrome.storage.sync.onChanged.addListener(listenForChanges)
    }
})()

function listenForChanges(changes: { [key: string]: chrome.storage.StorageChange }) {
    Object.keys(changes).forEach(key => features[key]?.(changes[key]?.newValue))
}

/**
 * Friend Activity Tracker
 */

async function toggleTracker(enable: boolean) {
    if (!enable) {
        state.shouldReattach = false

        if (chrome.debugger.onDetach.hasListener(retryOnDebuggerDetached)) {
            chrome.debugger.onDetach.removeListener(retryOnDebuggerDetached)
            chrome.debugger.onEvent.removeListener(onDebuggerEvent)
            chrome.tabs.onUpdated.removeListener(onTabUpdated)
            chrome.webRequest.onBeforeRequest.removeListener(attachOnRequest)
        }

        if (state.isAttached) {
            chrome.debugger.detach({ tabId: state.attachedTabId })
            handleDetach(false)
        }
        
        return;
    }

    // Initialize listeners once
    if (!chrome.debugger.onDetach.hasListener(retryOnDebuggerDetached)) {
        chrome.debugger.onDetach.addListener(retryOnDebuggerDetached)
        chrome.debugger.onEvent.addListener(onDebuggerEvent)
        chrome.tabs.onUpdated.addListener(onTabUpdated)
    }

    chrome.storage.session.set({ debuggerState: 'detached' })
    findTargets()
}

// Attach debugger to roblox.com pages (with userhub websocket) for presence data
// TODO: Implement XHR/websocket interceptor that does not use chrome.debugger

async function findTargets() {
    chrome.tabs.query({ url: "https://www.roblox.com/*" }, (tabs) => {
        const validTab = tabs.find(tab => tab.status !== 'unloaded')
        if (validTab?.id) { attemptAttach(validTab.id, validTab.url) }
    })

    chrome.webRequest.onBeforeRequest.addListener(attachOnRequest, { urls: ["https://www.roblox.com/*"] })
}

function attachOnRequest(details: chrome.webRequest.WebRequestBodyDetails) {
    attemptAttach(details.tabId, details.url)
}

async function attemptAttach(tabId: number, url?: string) {
    if (state.isAttaching || state.isAttached) return;
    // Do not attach to login page (account switcher page works, but implementation is deemed unnecessary)
    if (!url || !url?.match(RobloxWWWRegex) || RobloxLoginRegex.test(url)) return;

    state.isAttaching = true
    try {
        await chrome.debugger.attach({ tabId }, '1.3')
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable')
        
        state.isAttached = true
        state.attachedTabId = tabId
        chrome.storage.session.set({ debuggerState: 'attached' })
        chrome.webRequest.onBeforeRequest.removeListener(attachOnRequest)
    } catch (error: any) {
        if (error.message !== 'Cannot access a chrome:// URL') {
            console.error('Failed to attach:', error)
        }
    } finally {
        state.isAttaching = false
    }
}

async function onDebuggerEvent(source: chrome.debugger.Debuggee, method: string, params: any) {
    if (
        // https://github.com/chromedp/chromedp/issues/1317#issuecomment-1561122839
        // These guard nodes prevent 'No resource with given identifier',
        // and 'No data found for resource with given identifier' errors.
        method === 'Network.responseReceived' &&
        params.response.url.match(RobloxPresenceRegex) &&
        params.response.status === 200 &&
        params.type !== 'Preflight' &&
        params.response.headers['content-length'] !== 0
    ) {
        try {
            const response = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId }) as ResponseBody
            const data = JSON.parse(response.body)
            if (data.userPresences?.length <= CONFIG.MAXIMUM_USER_PRESENCE_IN_SINGLE_REQUEST) {
                notifyActivity(data.userPresences)
            }
        } catch (error) {
            // Retry once silently
            setTimeout(async () => {
                try {
                    const response = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId }) as ResponseBody
                    const data = JSON.parse(response.body)
                    if (data.userPresences?.length <= CONFIG.MAXIMUM_USER_PRESENCE_IN_SINGLE_REQUEST) {
                        const userPresencesObject: UserPresencesResponse = data
                        notifyActivity(userPresencesObject.userPresences)
                    }
                } catch (error) {
                    if (!(error instanceof SyntaxError) && state.isAttached) {
                        console.error(error)
                    }
                }
            }, CONFIG.RETRY_REQUESTS_DELAY);
        }
    }
}

// TODO: Prevent authenticated user from appearing in notifications
// TODO: Prevent false positives as a result of the Presence API returning invalid data
// TODO: Implement session cache to prevent unnecessary strain on API
// TODO: Implement filter for game activity with user-friendly interface
// TODO: Add buttons to launch game client from notification
// TODO: Lead user to the game's page when clicking on notification
// TODO: Create self-deleting notifications
async function notifyActivity(userPresences: UserPresence[]) {
    for (const presence of userPresences) {
        const pString = JSON.stringify(presence)
        // Prevent duplicates and non-matching presence data
        if (state.recentPresences.includes(pString)) continue;
        if (!presence.rootPlaceId || presence.userPresenceType !== UserPresenceType.InGame) continue;
        // Temporarily mark as duplicate
        state.recentPresences.push(pString)
        setTimeout(() => {
            removeValueFromArray(state.recentPresences, pString)
        }, CONFIG.USER_PRESENCE_COOLDOWN);

        const isSubPlace = presence.placeId !== presence.rootPlaceId
        const placeIds = isSubPlace ? `${presence.rootPlaceId}&placeIds=${presence.placeId}` : presence.rootPlaceId
        const [games, user, iconUrl] = await Promise.all([
            fetch(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeIds}`).then(r => r.json()),
            getUserFromUserId(presence.userId),
            getAvatarIconUrlFromUserId(presence.userId, AvatarIconStyle.AvatarHeadshot, AvatarIconSize.Hundred)
        ])

        chrome.notifications.create({
            type: 'basic',
            priority: 2,
            iconUrl: await getDataUrlFromWebResource(iconUrl),
            title: `${user.displayName} is ${isSubPlace ? 'in a subplace' : 'playing'}!`,
            message: `Now in: ${isSubPlace ? games[1].name : games[0].name}`,
            contextMessage: isSubPlace ? `Part of: ${games[0]?.name}` : ''
        })
    }
}

// Detach debugger if no longer on www.roblox.com
async function onTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
    if (
        changeInfo.url && tabId === state.attachedTabId &&
        (!changeInfo.url.match(RobloxWWWRegex) || RobloxLoginRegex.test(changeInfo.url))
    ) {
        chrome.debugger.detach({ tabId })
    }
}

// Passing arguments to a callback function requires a wrapper function:
// https://stackoverflow.com/questions/17238348/using-addeventlistener-to-add-a-callback-with-arguments/17238581#17238581
// Wrapper function cannot be anonymous to allow for removal if necessary:
// https://stackoverflow.com/questions/4950115/removeeventlistener-on-anonymous-functions-in-javascript
async function retryOnDebuggerDetached() {
    handleDetach(true)
}

async function handleDetach(shouldRetry: boolean) {
    state.isAttached = false
    state.attachedTabId = 0
    chrome.storage.session.set({ debuggerState: 'detached' })

    if (shouldRetry) {
        state.shouldReattach = true
        findTargets()
        setTimeout(() => {
            if (!state.isAttached && state.shouldReattach) {
                chrome.notifications.create({
                    type: 'basic',
                    priority: 2,
                    iconUrl: './utils/RBLX_Tilt_Primary_Black.png',
                    title: 'Friend Activity Tracker is disabled!',
                    message: 'You will no longer receive notifications on friend activity.',
                    contextMessage: 'To reenable, make sure to keep the website open and stay logged in!'
                })
            }
        }, CONFIG.DETACHED_DEBUGGER_ALERT_DELAY);
    }
}