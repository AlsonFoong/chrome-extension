/**
 * Extension
 */

const enum ErrorMessage {
    Default = 'Something went wrong. Check the console for information.',
    NoErrorsPassed = 'No errors were passed to the error handler!',
    FileReaderFail = 'FileReader could not process the data provided.',
    InvalidUserId = 'Invalid user ID provided!',
    InvalidWebResource = 'Invalid web resource provided!',
    AvatarIconFail = 'Failed to fetch avatar icon.'
}

interface ResponseBody {
    body: string,
    base64Encoded: boolean
}

interface FeatureMap {
    [key: string]: (enabled: boolean) => void
}

/**
 * Roblox API
 */

interface UserObject {
    description: string,
    created: string,
    isBanned: boolean,
    externalAppDisplayName?: string,
    hasVerifiedBadge: boolean,
    id: number,
    name: string,
    displayName: string
}

interface UserPresencesResponse {
    userPresences: UserPresence[]
}

interface UserPresence {
    userPresenceType: UserPresenceType,
    lastLocation: string,
    placeId: number,
    rootPlaceId: number,
    gameId: number,
    universeId: number,
    userId: number,
    lastOnline: string,
    invisibleModeExpiry?: string
}

const enum UserPresenceType {
    Offline = 0,
    Online = 1,
    InGame = 2,
    InStudio = 3,
    Invisible = 4
}

interface ThumbnailResponse {
    data: ThumbnailObject[]
}

interface ThumbnailObject {
    targetId: number,
    state: ThumbnailState,
    imageUrl: URL,
    version: string
}

const enum ThumbnailState {
    Error = 'Error',
    Completed = 'Completed',
    InReview = 'InReview',
    Pending = 'Pending',
    Blocked = 'Blocked',
    TemporarilyUnavailable = 'TemporarilyUnavailable'
}

const enum AvatarIconStyle {
    Avatar = 'avatar',
    AvatarBust = 'avatar-bust',
    AvatarHeadshot = 'avatar-headshot'
}

const enum AvatarIconSize {
    // -exclusions
    Thirty = 30, // -bust -headshot
    FourtyEight = 48,
    Fifty = 50, // -avatar
    Sixty = 60,
    SeventyFive = 75,
    Hundred = 100,
    HundredAndTen = 110, // -bust
    HundredAndFourty = 140, // -bust -headshot
    HundredAndFifty = 150,
    // 150x200 option available for avatar
    HundredAndEighty = 180,
    TwoHundredAndFifty = 250, // -bust -headshot
    ThreeHundredAndFiftyTwo = 352,
    FourHundredAndTwenty = 420,
    SevenHundredAndTwenty = 720 // -bust
}