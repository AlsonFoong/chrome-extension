import { getUserFromUserId, getAvatarIconUrlFromUserId, getDataUrlFromWebResource, RobloxWWWRegex, RobloxLoginRegex, RobloxPresenceRegex, removeValueFromArray } from "./utils/utility.js";
const CONFIG = {
    DETACHED_DEBUGGER_ALERT_DELAY: 10000,
    RETRY_REQUESTS_DELAY: 5000,
    USER_PRESENCE_COOLDOWN: 15000,
    MAXIMUM_USER_PRESENCE_IN_SINGLE_REQUEST: 3
};
const state = {
    shouldReattach: false,
    isAttached: false,
    isAttaching: false,
    attachedTabId: 0,
    recentPresences: []
};
function toggleRulesets(enable, rulesetIds) {
    chrome.declarativeNetRequest.updateEnabledRulesets({ [enable ? 'enableRulesetIds' : 'disableRulesetIds']: rulesetIds });
}
function toggleRules(enable, ruleIds, rulesetId) {
    chrome.declarativeNetRequest.updateStaticRules({ rulesetId, [enable ? 'enableRuleIds' : 'disableRuleIds']: ruleIds });
}
const features = {
    enableFriendActivityTracker: toggleTracker,
    enableFriendCarouselExtension: (enable) => toggleRulesets(enable, ['ruleset_FriendCarouselExtension']),
    enableAvatarHeadshotURLRedirect: (enable) => toggleRulesets(enable, ['ruleset_AvatarHeadshotURLRedirect']),
    enableUnfriendBlocker: (enable) => toggleRules(enable, [1], 'ruleset_XhrBlocker'),
    enableLogoutBlocker: (enable) => toggleRules(enable, [2], 'ruleset_XhrBlocker')
};
(async () => {
    const settings = await chrome.storage.sync.get(Object.keys(features));
    Object.entries(features).forEach(([key, handler]) => handler(!!settings[key]));
    if (!chrome.storage.sync.onChanged.hasListener(listenForChanges)) {
        chrome.storage.sync.onChanged.addListener(listenForChanges);
    }
})();
function listenForChanges(changes) {
    Object.keys(changes).forEach(key => features[key]?.(changes[key]?.newValue));
}
async function toggleTracker(enable) {
    if (!enable) {
        state.shouldReattach = false;
        if (chrome.debugger.onDetach.hasListener(retryOnDebuggerDetached)) {
            chrome.debugger.onDetach.removeListener(retryOnDebuggerDetached);
            chrome.debugger.onEvent.removeListener(onDebuggerEvent);
            chrome.tabs.onUpdated.removeListener(onTabUpdated);
            chrome.webRequest.onBeforeRequest.removeListener(attachOnRequest);
        }
        if (state.isAttached) {
            chrome.debugger.detach({ tabId: state.attachedTabId });
            handleDetach(false);
        }
        return;
    }
    if (!chrome.debugger.onDetach.hasListener(retryOnDebuggerDetached)) {
        chrome.debugger.onDetach.addListener(retryOnDebuggerDetached);
        chrome.debugger.onEvent.addListener(onDebuggerEvent);
        chrome.tabs.onUpdated.addListener(onTabUpdated);
    }
    chrome.storage.session.set({ debuggerState: 'detached' });
    findTargets();
}
async function findTargets() {
    chrome.tabs.query({ url: "https://www.roblox.com/*" }, (tabs) => {
        const validTab = tabs.find(tab => tab.status !== 'unloaded');
        if (validTab?.id) {
            attemptAttach(validTab.id, validTab.url);
        }
    });
    chrome.webRequest.onBeforeRequest.addListener(attachOnRequest, { urls: ["https://www.roblox.com/*"] });
}
function attachOnRequest(details) {
    attemptAttach(details.tabId, details.url);
}
async function attemptAttach(tabId, url) {
    if (state.isAttaching || state.isAttached)
        return;
    if (!url || !url?.match(RobloxWWWRegex) || RobloxLoginRegex.test(url))
        return;
    state.isAttaching = true;
    try {
        await chrome.debugger.attach({ tabId }, '1.3');
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
        state.isAttached = true;
        state.attachedTabId = tabId;
        chrome.storage.session.set({ debuggerState: 'attached' });
        chrome.webRequest.onBeforeRequest.removeListener(attachOnRequest);
    }
    catch (error) {
        if (error.message !== 'Cannot access a chrome:// URL') {
            console.error('Failed to attach:', error);
        }
    }
    finally {
        state.isAttaching = false;
    }
}
async function onDebuggerEvent(source, method, params) {
    if (method === 'Network.responseReceived' &&
        params.response.url.match(RobloxPresenceRegex) &&
        params.response.status === 200 &&
        params.type !== 'Preflight' &&
        params.response.headers['content-length'] !== 0) {
        try {
            const response = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
            const data = JSON.parse(response.body);
            if (data.userPresences?.length <= CONFIG.MAXIMUM_USER_PRESENCE_IN_SINGLE_REQUEST) {
                notifyActivity(data.userPresences);
            }
        }
        catch (error) {
            setTimeout(async () => {
                try {
                    const response = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
                    const data = JSON.parse(response.body);
                    if (data.userPresences?.length <= CONFIG.MAXIMUM_USER_PRESENCE_IN_SINGLE_REQUEST) {
                        const userPresencesObject = data;
                        notifyActivity(userPresencesObject.userPresences);
                    }
                }
                catch (error) {
                    if (!(error instanceof SyntaxError) && state.isAttached) {
                        console.error(error);
                    }
                }
            }, CONFIG.RETRY_REQUESTS_DELAY);
        }
    }
}
async function notifyActivity(userPresences) {
    for (const presence of userPresences) {
        const pString = JSON.stringify(presence);
        if (state.recentPresences.includes(pString))
            continue;
        if (!presence.rootPlaceId || presence.userPresenceType !== 2)
            continue;
        state.recentPresences.push(pString);
        setTimeout(() => {
            removeValueFromArray(state.recentPresences, pString);
        }, CONFIG.USER_PRESENCE_COOLDOWN);
        const isSubPlace = presence.placeId !== presence.rootPlaceId;
        const placeIds = isSubPlace ? `${presence.rootPlaceId}&placeIds=${presence.placeId}` : presence.rootPlaceId;
        const [games, user, iconUrl] = await Promise.all([
            fetch(`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeIds}`).then(r => r.json()),
            getUserFromUserId(presence.userId),
            getAvatarIconUrlFromUserId(presence.userId, "avatar-headshot", 100)
        ]);
        chrome.notifications.create({
            type: 'basic',
            priority: 2,
            iconUrl: await getDataUrlFromWebResource(iconUrl),
            title: `${user.displayName} is ${isSubPlace ? 'in a subplace' : 'playing'}!`,
            message: `Now in: ${isSubPlace ? games[1].name : games[0].name}`,
            contextMessage: isSubPlace ? `Part of: ${games[0]?.name}` : ''
        });
    }
}
async function onTabUpdated(tabId, changeInfo) {
    if (changeInfo.url && tabId === state.attachedTabId &&
        (!changeInfo.url.match(RobloxWWWRegex) || RobloxLoginRegex.test(changeInfo.url))) {
        chrome.debugger.detach({ tabId });
    }
}
async function retryOnDebuggerDetached() {
    handleDetach(true);
}
async function handleDetach(shouldRetry) {
    state.isAttached = false;
    state.attachedTabId = 0;
    chrome.storage.session.set({ debuggerState: 'detached' });
    if (shouldRetry) {
        state.shouldReattach = true;
        findTargets();
        setTimeout(() => {
            if (!state.isAttached && state.shouldReattach) {
                chrome.notifications.create({
                    type: 'basic',
                    priority: 2,
                    iconUrl: './utils/RBLX_Tilt_Primary_Black.png',
                    title: 'Friend Activity Tracker is disabled!',
                    message: 'You will no longer receive notifications on friend activity.',
                    contextMessage: 'To reenable, make sure to keep the website open and stay logged in!'
                });
            }
        }, CONFIG.DETACHED_DEBUGGER_ALERT_DELAY);
    }
}
