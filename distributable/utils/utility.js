export const RobloxWebsiteRegex = /^https?\:\/\/(\S+\.)*roblox\.com(.+)?$/;
export const RobloxWWWRegex = /^https?\:\/\/www\.roblox\.com/;
export const RobloxLoginRegex = /^https?\:\/\/(\S+\.)*roblox\.com\/?([Ll]ogin)?$/;
export const RobloxPresenceRegex = /^https?\:\/\/presence\.roblox\.com/;
export function removeValueFromArray(array, value, once) {
    if (typeof (value) === 'object') {
        for (let index = 0; index < array.length; index++) {
            const element = array[index];
            try {
                if (JSON.stringify(element) === JSON.stringify(value)) {
                    array.splice(index, 1);
                    if (once)
                        return array;
                    index--;
                }
            }
            catch (error) {
            }
        }
    }
    else {
        for (let index = 0; index < array.length; index++) {
            const element = array[index];
            if (element === value) {
                array.splice(index, 1);
            }
        }
    }
    return array;
}
export async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(fileReader.result);
        fileReader.onerror = () => reject(new Error("FileReader could not process the data provided."));
        fileReader.readAsDataURL(blob);
    });
}
export async function getDataUrlFromWebResource(url) {
    return new Promise(async (resolve, _reject) => {
        const blob = await fetch(url).then(response => response.blob());
        const dataUrl = await blobToDataUrl(blob);
        resolve(dataUrl);
    });
}
export async function getUserFromUserId(userId) {
    return new Promise(async (resolve, _reject) => {
        const userObject = await fetch(`https://users.roblox.com/v1/users/${userId}`).then(response => response.json());
        resolve(userObject);
    });
}
export async function getAvatarIconUrlFromUserId(userId, type = "avatar-headshot", size = 420) {
    return new Promise(async (resolve, reject) => {
        const response = await fetch(`https://thumbnails.roblox.com/v1/users/${type}?userIds=${userId}&size=${size}x${size}&format=Png&isCircular=false`).then(response => response.json());
        const iconObject = response.data[0];
        if (!iconObject) {
            reject(new Error("Failed to fetch avatar icon.", { cause: `User ID: ${userId}\nResponse body: ${response}` }));
        }
        if (iconObject.state !== 'Completed') {
            reject(new Error("Failed to fetch avatar icon.", { cause: `User ID: ${userId}\nResponse body: ${response}\niconObject: ${iconObject}` }));
        }
        resolve(iconObject.imageUrl);
    });
}
