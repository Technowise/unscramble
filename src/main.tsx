import { Devvit, useState, ContextAPIClients, RedisClient, UIClient, UseStateResult, useChannel, UseChannelResult, TriggerContext} from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  realtime: true,
  redis: true,
});

enum PayloadType {
  SubmittedName,
  NewNamesAndLetters,
  TriggerShowAnswer
}

type namesAndLetters = {
  letters: string;
  names: string[];
};

type UserGameState = {
  userSelectedLetters: string;
  userLetters: string;
}

type UserSubmittedName = {
  name: string;
  username: string;
};

type answeredNames = {
  names: UserSubmittedName[];
};

type ShowAnswer = {
};

type RealtimeMessage = {
  payload: UserSubmittedName | namesAndLetters| ShowAnswer;
  type: PayloadType;
};

function sessionId(): string {
  let id = '';
  const asciiZero = '0'.charCodeAt(0);
  for (let i = 0; i < 4; i++) {
    id += String.fromCharCode(Math.floor(Math.random() * 26) + asciiZero);
  }
  return id;
}

function splitArray<T>(array: T[], segmentLength: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += segmentLength) {
    result.push(array.slice(i, i + segmentLength));
  }
  return result;
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

const redisExpireTimeSeconds = 2592000;//30 days in seconds.
let dateNow = new Date();
const milliseconds = redisExpireTimeSeconds * 1000;
const expireTime = new Date(dateNow.getTime() + milliseconds);

Devvit.addSchedulerJob({
  name: 'change_letters_job',  
  onRun: async(event, context) => {
    console.log("running change_letters_job");
    const rms: RealtimeMessage = { payload: {}, type: PayloadType.TriggerShowAnswer};
    await context.realtime.send('events', rms);
    //TODO: Add settimeout of 5 seconds before setting new set of letters.
    const namesAndLettersObj:namesAndLetters = getRandomNamesAndLetters();
    await context.redis.set('namesAndLetters',  JSON.stringify(namesAndLettersObj), {expiration: expireTime});
    console.log("Stored names into redis");
    const rm: RealtimeMessage = { payload: namesAndLettersObj, type: PayloadType.NewNamesAndLetters};
    await context.realtime.send('events', rm);
    await context.redis.expire('changeLettersJobId', redisExpireTimeSeconds);//Extend expire time for changeLettersJobId.
    await context.redis.del('answeredNames');
  },
});

async function createChangeLettersThread(context:TriggerContext) {

  const allJobs = await context.scheduler.listJobs();

  for(var i=0; i< allJobs.length; i++ ){
    await context.scheduler.cancelJob(allJobs[i].id);//delete all old schedules.
  }

  /*
  const changeLettersJobId = await context.redis.get('changeLettersJobId');
  if ( changeLettersJobId && changeLettersJobId.length > 0) {//Cancel previous job if it exists.
    await context.scheduler.cancelJob(changeLettersJobId);
  } */

  try {
    const jobId = await context.scheduler.runJob({
      //cron: '*/10 * * * *',
      cron: '*/2 * * * *',
      name: 'change_letters_job',
      data: {},
    });
    await context.redis.set('changeLettersJobId', jobId, {expiration: expireTime});
    console.log("Created job schedule for changeLetters: "+jobId);
  } catch (e) {
    console.log('error - was not able to create job:', e);
    throw e;
  }
  
}

Devvit.addTrigger({  
  event: 'AppInstall',  
  onEvent: async (_, context) => {
    createChangeLettersThread(context);
  },
});

Devvit.addTrigger({  
  event: 'AppUpgrade',  
  onEvent: async (_, context) => {
    createChangeLettersThread(context);
  },
});

function getRandomNamesAndLetters(){
  var name1index = Math.floor(Math.random() * character_names.length/2);
  var name2index = Math.floor(Math.random() * character_names.length/2);

  //Pick first name from first half of the names array, Pick second name from second half of the names array.

  var allLetters = character_names[name1index] + character_names[ character_names.length/2 + name2index];

  var shuffledLetters = allLetters.split('').sort(function(){return 0.5-Math.random()}).join('');
  console.log("Shuffled letters: "+ shuffledLetters);

  return {names: [ character_names[name1index], character_names[ character_names.length/2 + name2index] ], letters: shuffledLetters };
}

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
        const namesAndLettersJson = await this.redis.get('namesAndLetters');
        if ( namesAndLettersJson && namesAndLettersJson.length > 0) {//Cancel previous job if it exists.
          const namesAndLettersObj = JSON.parse(namesAndLettersJson);
          const nl = namesAndLettersObj as namesAndLetters;
          return nl;
        }
        else {
          const nl:namesAndLetters = getRandomNamesAndLetters();
          await context.redis.set('namesAndLetters',  JSON.stringify(nl), {expiration: expireTime});
          console.log("Stored names into redis");
          return nl;
        }
      }
    );

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
        console.log("Message payload received, here's the message:");
        console.log(payload);

        if(msg.type == PayloadType.SubmittedName) { //TODO: Add points for user, and sync to Redis.
          const pl = msg.payload as UserSubmittedName;      
          this.pushStatusMessage(pl.username+" made the name: "+ pl.name.toLocaleUpperCase()+". Well done!");
        }
        else if (msg.type == PayloadType.NewNamesAndLetters ){
          //TODO: Show the answer in the messages block, and only then show the new letters.
          console.log("New names and letters received:");
          console.log(msg.payload);
          const nl = msg.payload as namesAndLetters;
          this.namesAndLetters = nl;        
          this.pushStatusMessage("Which two names can you make out of "+nl.letters.toUpperCase()+" ?" );
          const UGS:UserGameState = {userSelectedLetters:'', userLetters: nl.letters};
          this.userGameStatus = UGS;
        }
        else if  (msg.type == PayloadType.TriggerShowAnswer) {
          this.pushStatusMessage("Answer: Two names were: "+this.namesAndLetters.names[0].toUpperCase() +" and "+this.namesAndLetters.names[1].toUpperCase() );          
        }
      },
    });

    this._channel.subscribe();
  }

  public pushStatusMessage(message:string){
    var messages = this.statusMessages;
    messages.push(message);
    if( messages.length > 4) {
      messages.shift();//Remove last message if we already have 10 messages.
    }
    this.statusMessages =  messages;
  }

  public resetSelectedLetters() {
    var ugs = this.userGameStatus;//Reset selected letters for this user.
    ugs.userLetters = this.userGameStatus.userLetters + this.userGameStatus.userSelectedLetters;
    ugs.userSelectedLetters = "";
    this.userGameStatus = ugs;
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

  public async getAnsweredNames() {
    const answeredNamesJson = await this.redis.get('answeredNames');
    if( answeredNamesJson && answeredNamesJson.length > 0 ) {
      const answeredNamesObj = JSON.parse(answeredNamesJson);
      const an = answeredNamesObj as answeredNames;
      return an;
    }
    else {
      const an:answeredNames = {names:[]}
      return an;
    }
  }

  public async verifyName(){

    const an = await this.getAnsweredNames();

    console.log("Answered names:");
    console.log(an);

    if( character_names.includes(this.userGameStatus.userSelectedLetters) ) {

      //Check if the submitted name was already answered by someone.
      var alreadyAnswered = false;
      for(var i=0; i< an.names.length; i++) {//TODO: Use find method for this lookup later.

        if( an.names[i].name ==  this.userGameStatus.userSelectedLetters) {
          alreadyAnswered = true;
          this._context.ui.showToast({
            text: "This name was already answered by /u/"+an.names[i].username,
            appearance:"neutral",
          });
        }
      }

      if( ! alreadyAnswered) {
        this._context.ui.showToast({
          text: "That's a correct name, congratulations!",
          appearance: 'success',
        });
        const pl:UserSubmittedName = { name:this.userGameStatus.userSelectedLetters, username: this.currentUsername};
        const rm: RealtimeMessage = { payload: pl, type: PayloadType.SubmittedName};
        await this._channel.send(rm);
        this.resetSelectedLetters();
        an.names.push(pl);
        if( an.names.length == this.namesAndLetters.names.length ) {//All names are already answered. Time to change the names and letters.
          const nl:namesAndLetters = getRandomNamesAndLetters();
          await this.redis.set('namesAndLetters',  JSON.stringify(nl), {expiration: expireTime});
          console.log("Stored new names into redis");
          const rm: RealtimeMessage = { payload: nl, type: PayloadType.NewNamesAndLetters};
          await this._channel.send(rm);
          await this.redis.del('answeredNames');
          //TODO: Resetup scheduler so that it only gets triggered only after x minutes of time after this change.
        }
        else {//add to answered names list in redis.
          await this.redis.set('answeredNames',  JSON.stringify(an), {expiration: expireTime});
        }
      }
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
      title: 'Southpark Unscramble Game',
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
  height: 'tall',
  render: (_context) => {

    const myPostId = _context.postId ?? 'defaultPostId';
    const game = new UnscrambleGame(_context, myPostId);

    const letterCells = game.userGameStatus.userLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor="black" cornerRadius="small" onPress={() => game.addCharacterToSelected(index)}>
          <text size="large" color="black" weight="bold">{letter.toUpperCase()}</text>
        </vstack>
        <spacer size="xsmall" />
      </>
    ));

    const selectedLetterCells = game.userGameStatus.userSelectedLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor="black" cornerRadius="small" onPress={() => game.removeCharacter(index)}>
          <text size="large" color="black" weight="bold">{letter.toUpperCase()}</text>
        </vstack>
      <spacer size="xsmall" />
      </>
    ));

    const SelectedLettersBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack alignment="start middle" width="312px" border="thin" borderColor='black' padding='small' minHeight="90px" >
        <text size="medium" weight='bold' color='black'>Selected letters:</text>
        {game.userGameStatus.userSelectedLetters.length == 0 ? <text size="medium" color="black">None</text>: ""}
        {splitArray(selectedLetterCells, 10).map((row) => ( <>
          <hstack>{row}</hstack>
          <spacer size="xsmall" />
        </>
        ))}
        <spacer size="medium" />
        <hstack alignment="center middle" width="100%">
          <button size="small" icon='close' onPress={() => game.verifyName()}>Submit</button> <spacer size="small" />
          <button size="small" icon='close' onPress={() => game.resetSelectedLetters()}>Reset</button>
        </hstack>
      </vstack>);

    console.log("here are the random names:");
    console.log(game.names);

    return (
    <blocks height="tall">
      <vstack alignment="center middle" width="100%" height="100%">
        <vstack height="100%" width="344px" alignment="center top" padding="medium" backgroundColor='#ccc'>

          <text style="heading" size="large" weight='bold' alignment="center middle" color='black' width="330px" height="50px" wrap>
            Which Southpark character names can you make out of these letters?
          </text>
          <spacer size="xsmall" />

          <text style="heading" size="small" weight='bold' alignment="center middle" color='black' width="312px" wrap>
            Click on the characters to select.
          </text>
          <vstack alignment="start middle" width="312px" border="thin" borderColor='black' padding='small' >
            {splitArray(letterCells, 10).map((row) => ( <>
              <hstack>{row}</hstack>
              <spacer size="xsmall" />
            </>
            ))}
          </vstack>

          <spacer size="medium" />

          <SelectedLettersBlock game={game} />

          <spacer size="medium" />  
          <text style="heading" size="medium" weight='bold' color='black'>
            Game Feed
          </text>
          <vstack borderColor='grey' padding='small' height="170px" width="330px" backgroundColor='white'>
            <vstack>
            {
                game.statusMessages.map((message) => (
                  <>
                    <text wrap color="black" size="small">{message}</text> 
                    <spacer size="small"/>
                  </>
              ))}
            </vstack>
          </vstack>
        </vstack>
      </vstack>
    </blocks>
    );
  },
});

export default Devvit;



