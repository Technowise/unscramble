// Learn more at developers.reddit.com/docs
import { Devvit, useState, ContextAPIClients, RedisClient, UIClient, UseStateResult, useChannel, UseChannelResult} from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  realtime: true,
});

type namesAndLetters = {
  letters: string;
  names: string[];
};

type UserGameState = {
  userSelectedLetters: string;
  userLetters: string;
}

type Payload = {
  name: string;
  username: string;
};

type RealtimeMessage = {
  payload: Payload;
  session: string;
  postId: string;
};

function sessionId(): string {
  let id = '';
  const asciiZero = '0'.charCodeAt(0);
  for (let i = 0; i < 4; i++) {
    id += String.fromCharCode(Math.floor(Math.random() * 26) + asciiZero);
  }
  return id;
}

//Later, this should come from config value for the subreddit, from redis.
const character_names = ["eric", "kenny", "kyle", "stan", 
                          "butters", "token", "wendy", "bebe", "tweek", "craig", "timmy", 
                          "randy", "sharon", "gerald", "sheila", "liane", 
                          "garrison", "mackey", "victoria", 
                          "chief", "barbrady", "mcdaniels", 
                          "terrance", "philippe", "jimbo", "hankey",
                          "satan", "scott",
                          "jesus", "buddha"];

class UnscrambleGame {
  private _redisKeyPrefix: string;
  private redis: RedisClient;
  private readonly _ui: UIClient;
  private _context: ContextAPIClients;
  private _ScreenIsWide: boolean;
  private _currentUsername: UseStateResult<string>;
  private _myPostId: UseStateResult<string>;
  private _namesAndLettersObj:UseStateResult<namesAndLetters>;
  private _userGameStatus: UseStateResult<UserGameState>;
  private _statusMessages: UseStateResult<string[]>;
  private _channel: UseChannelResult<RealtimeMessage>;
  private _session: UseStateResult<string>;

  constructor( context: ContextAPIClients, postId: string) {
    this._context = context;
    this._ui = context.ui;
    this.redis = context.redis;
    this._ScreenIsWide = this.isScreenWide();
    this._statusMessages = context.useState(async () => {
      var messages: string[] = [];
      return messages;//TODO: set this up to get list of current status messages from redis.
    });
  
    this._myPostId = context.useState(async () => {
      return postId;
    });

    this._session = context.useState(async () => {
      return sessionId();
    });

    this._currentUsername = context.useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      return currentUser?.username??'defaultUsername';
    });

    this._redisKeyPrefix = this.myPostId + this.currentUsername;

    this._namesAndLettersObj = context.useState<namesAndLetters>(
      async() =>{
        const n:namesAndLetters = this.getRandomNamesAndLetters();
        return n;
      }
    );
    //this._namesAndLettersObj = this.getRandomNamesAndLetters();

    

    this._userGameStatus = context.useState<UserGameState>(
      async() =>{
        const UGS:UserGameState = {userSelectedLetters:'', userLetters: this._namesAndLettersObj[0].letters};
        return UGS;
      }
    );


    this._channel = useChannel<RealtimeMessage>({
      name: 'events',
      onMessage: (msg) => {

        const payload = msg.payload;
        console.log("Message payload received:");
        console.log(payload);

        var messages = this.statusMessages;
        messages.push(msg.payload.username+" made the name: "+ msg.payload.name.toLocaleUpperCase()+". Well done!");
        //TODO: Add points for user, and sync to Redis.
        if( messages.length > 2) {
          messages.shift();//Remove last message if we already have 10 messages.
        }
        this.statusMessages =  messages;

        if (msg.session === this._session[0] || msg.postId !== this._myPostId[0]) {
          //Ignore my updates b/c they have already been rendered
          return;
        }

        //updateCanvas(payload.index, payload.color);
      },
    });

    this._channel.subscribe();

  }

  public getRandomNamesAndLetters(){
    var name1index = Math.floor(Math.random() * character_names.length/2);
    var name2index = Math.floor(Math.random() * character_names.length/2);

    //Pick first name from first half of the names array, Pick second name from second half of the names array.

    var allLetters = character_names[name1index] + character_names[ character_names.length/2 + name2index];

    var shuffledLetters = allLetters.split('').sort(function(){return 0.5-Math.random()}).join('');
    console.log("Shuffled letters: "+ shuffledLetters);

    return {names: [ character_names[name1index], character_names[ character_names.length/2 + name2index] ], letters: shuffledLetters };
  }

  public addCharacterToSelected(index:number) {
    var ugs:UserGameState = this.userGameStatus;
    ugs.userSelectedLetters = ugs.userSelectedLetters + ugs.userLetters[index];
    var letters = Array.from(ugs.userLetters);
    letters.splice(index, 1);
    ugs.userLetters = letters.join('');
    this.userGameStatus = ugs;
  }

  public removeCharacter(index:number) {
    var ugs:UserGameState = this.userGameStatus;
    ugs.userLetters = ugs.userLetters + ugs.userSelectedLetters[index];
    var letters = Array.from(ugs.userSelectedLetters);
    letters.splice(index, 1);
    ugs.userSelectedLetters = letters.join('');
    this.userGameStatus = ugs;
  }

  public get myPostId() {
    return this._myPostId[0];
  }

  public get letters() {
    return this._namesAndLettersObj[0].letters;
  }

  public get names() {
    return this._namesAndLettersObj[0].names;
  }

  public get statusMessages() {
    return this._statusMessages[0];
  }

  public set statusMessages(messages: string[]) {
    this._statusMessages[0] = messages;
    this._statusMessages[1](messages);
  }

  get redisKeyPrefix() {
    return this._redisKeyPrefix;
  }

  public get currentUsername() {
    return this._currentUsername[0];
  }

  public get namesAndLetters() {
    return this._namesAndLettersObj[0];
  }

  public set namesAndLetters(value: namesAndLetters) {
    this._namesAndLettersObj[0] = value;
    this._namesAndLettersObj[1](value);
  }

  public get userGameStatus() {
    return this._userGameStatus[0];
  }

  public set userGameStatus(value: UserGameState) {
    this._userGameStatus[0] = value;
    this._userGameStatus[1](value);
  }

  private isScreenWide() {
    const width = this._context.dimensions?.width ?? null;
    return width == null ||  width < 688 ? false : true;
  }

  public async openIntroPage(){
    this._context.ui.navigateTo('https://www.reddit.com/r/Spottit/comments/1ethp30/introduction_to_spottit_game/');
  };

  public async verifyName(){

    if( character_names.includes(this.userGameStatus.userSelectedLetters) ) {
      this._context.ui.showToast({
        text: "That's a correct name, congratulations!",
        appearance: 'success',
      });

      var ugs = this.userGameStatus;

      const payload: Payload = { username: this.currentUsername, name: ugs.userSelectedLetters };
      const message: RealtimeMessage = { payload, session: this._session[0], postId: this.myPostId };
      await this._channel.send(message); 

      ugs.userLetters = this.userGameStatus.userLetters + this.userGameStatus.userSelectedLetters;
      ugs.userSelectedLetters = "";//Reset selected letters for this user.
      this.userGameStatus = ugs;

    }
    else {
      this._context.ui.showToast({
        text: "Sorry, that's not a valid character name!",
        appearance: 'neutral',
      });      
    }

  }

}

// Add a menu item to the subreddit menu for instantiating the new experience post
Devvit.addMenuItem({
  label: 'Create Unscramble Game post',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: 'Unscramble the letters to make names of characters',
      subredditName: subreddit.name,
      // The preview appears while the post loads
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading ...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Created an Unscramble post!' });
    context.ui.navigateTo(post.url);
  },
});

// Add a post type definition
Devvit.addCustomPostType({
  name: 'Unscramble Post',
  height: 'regular',
  render: (_context) => {

    const myPostId = _context.postId ?? 'defaultPostId';
    const game = new UnscrambleGame(_context, myPostId);

    console.log("here are the random names:");
    console.log(game.names);

    return (
      <vstack height="100%" width="100%" gap="medium" alignment="center middle">

        <text style="heading" size="large" weight='bold' alignment="middle center" color='black'>
          Can you make two Southpark character names out of these letters?
        </text>

        <hstack>
          {
            game.userGameStatus.userLetters.split("").map((row, index) => (
              <>
              <button appearance="destructive"  width="28px" height="28px" onPress={() => game.addCharacterToSelected(index)} >{row.toUpperCase()}</button> <spacer size="small"/>
              </>
          ))}
        </hstack>

        <text size="large">Selected Characters:</text>
        <hstack>
          {
            game.userGameStatus.userSelectedLetters.split("").map((row, index) => (
              <>
              <button appearance="destructive"  width="28px" height="28px" onPress={() => game.removeCharacter(index)} >{row.toUpperCase()}</button> <spacer size="small"/>
              </>
          ))}
        </hstack>

        <text style="heading" size="medium" weight='bold' alignment="middle center" color='black'>
         Messages:
        </text>
        <vstack>
        {
            game.statusMessages.map((message) => (
              <>
              <text >{message}</text> 
              <spacer size="small"/>
              </>
          ))}
        </vstack>

        <button size="small" icon='close' onPress={() => game.verifyName()}>Submit</button>
      </vstack>
    );
  },
});

export default Devvit;



