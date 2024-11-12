import { Devvit, ContextAPIClients, RedisClient, UIClient, UseStateResult, useChannel, UseChannelResult, TriggerContext, JobContext} from '@devvit/public-api';
import { usePagination } from '@devvit/kit';
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
  expireTimeMillis: number;
};

type UserGameState = {
  userSelectedLetters: string;
  userLetters: string;
  remainingTimeInSeconds: number
  totalNamesSolved: number;
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

type leaderBoard = {
  username: string;
  totalNamesSolved: number;
};

export enum Pages {
  Game,
  LeaderBoard,
  Help
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

const MaxMessagesCount = 5;
const showTitle = "South Park";
const minutesToSolve = 1
const leaderBoardPageSize = 10;

const praiseMessages = ["Good job! 👍🏼", "Well done! ✅"];
const redisExpireTimeSeconds = 2592000;//30 days in seconds.
const lettersExpireTimeSeconds = minutesToSolve * 60;

let dateNow = new Date();
const milliseconds = redisExpireTimeSeconds * 1000;
const expireTime = new Date(dateNow.getTime() + milliseconds);
const textColour = 'white';
const borderColour = "#7fa78c";
const letterBorderColour = 'black';

Devvit.addSchedulerJob({
  name: 'change_letters_job',  
  onRun: async(event, context) => {
    console.log("running change_letters_job");
    const rms: RealtimeMessage = { payload: {}, type: PayloadType.TriggerShowAnswer};
    await context.realtime.send('events', rms);

    //Get old names and letters from redis.
    const namesAndLettersJson = await context.redis.get('namesAndLetters');
    if ( namesAndLettersJson && namesAndLettersJson.length > 0) {//Cancel previous job if it exists.
      const namesAndLettersObj = JSON.parse(namesAndLettersJson);
      const nl = namesAndLettersObj as namesAndLetters;
      pushStatusMessageGlobal("Answer: Two names were: "+nl.names[0].toUpperCase() +" and "+nl.names[1].toUpperCase(), context );
    }

    const namesAndLettersObj:namesAndLetters = getRandomNamesAndLetters();
    await context.redis.set('namesAndLetters',  JSON.stringify(namesAndLettersObj), {expiration: expireTime});
    const rm: RealtimeMessage = { payload: namesAndLettersObj, type: PayloadType.NewNamesAndLetters};
    await context.realtime.send('events', rm);
    pushStatusMessageGlobal("Which two character names can you make out of "+namesAndLettersObj.letters.toUpperCase()+" ?", context );
    await context.redis.expire('changeLettersJobId', redisExpireTimeSeconds);//Extend expire time for changeLettersJobId.
    await context.redis.del('answeredNames');
  },
});

async function createChangeLettersThread(context:TriggerContext| ContextAPIClients) {
  const allJobs = await context.scheduler.listJobs();
  for(var i=0; i< allJobs.length; i++ ){
    await context.scheduler.cancelJob(allJobs[i].id);//delete all old schedules.
  }

  try {
    const jobId = await context.scheduler.runJob({
      cron: "*/"+minutesToSolve+" * * * *",
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
  let dateNow = new Date();
  const milliseconds = lettersExpireTimeSeconds * 1000;
  var lettersExpireTimeMillis = dateNow.getTime();
  lettersExpireTimeMillis = lettersExpireTimeMillis + milliseconds;
  return {names: [ character_names[name1index], character_names[ character_names.length/2 + name2index] ], letters: shuffledLetters, expireTimeMillis: lettersExpireTimeMillis };
}

//Update messages in redis so that other clients which load messages first time get the messages.
async function pushStatusMessageGlobal(message:string, context:JobContext|ContextAPIClients){
  var messages: string[] = [];
  var smJson = await context.redis.get('statusMessages');
  if( smJson && smJson.length > 0 ) {
    messages = JSON.parse(smJson);
  }
  messages.push(message);
  if( messages.length > MaxMessagesCount) {
    messages.shift();//Remove last message if we already have 10 messages.
  }
  await context.redis.set('statusMessages', JSON.stringify(messages), {expiration: expireTime});
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
  private _leaderBoardRec:UseStateResult<leaderBoard[]>;
  private _currPage: UseStateResult<Pages>;

  constructor( context: ContextAPIClients, postId: string) {
    this._context = context;
    this._ui = context.ui;
    this.redis = context.redis;
    this._ScreenIsWide = this.isScreenWide();
    this._statusMessages = context.useState(async () => {
      var messages: string[] = [];
      var smJson = await this.redis.get('statusMessages');
      if( smJson && smJson.length > 0 ) {
        messages = JSON.parse(smJson);
      }
      return messages;//TODO: set this up to get list of current status messages from redis.
    });
  
    this._myPostId = context.useState(async () => {
      return postId;
    });

    this._currentUsername = context.useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      return currentUser?.username??'defaultUsername';
    });


    this._currPage = context.useState(async () => {
      return Pages.Game;
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
          return nl;
        }
      }
    );

    this._userGameStatus = context.useState<UserGameState>(
      async() =>{
        let dateNow = new Date();
        const remainingTimeMillis = this._namesAndLettersObj[0].expireTimeMillis - dateNow.getTime();
        const UGS:UserGameState = {userSelectedLetters:'', userLetters: this._namesAndLettersObj[0].letters, remainingTimeInSeconds: remainingTimeMillis/1000, totalNamesSolved:0 };
        return UGS;
      }
    );

    this._leaderBoardRec = context.useState(async () => {//Get Leaderboard records.
      const previousLeaderBoard = await context.redis.hGetAll(this.myPostId);
      if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
        var leaderBoardRecords: leaderBoard[] = [];
        for (const key in previousLeaderBoard) {
          const redisLBObj = JSON.parse(previousLeaderBoard[key]);
          if( redisLBObj.username ) {
            if(redisLBObj.username == this.currentUsername) {
              const usg = this._userGameStatus[0];
              usg.totalNamesSolved = redisLBObj.totalNamesSolved;
              this.userGameStatus = usg;
            }
            const lbObj:leaderBoard = {username: redisLBObj.username, totalNamesSolved:redisLBObj.totalNamesSolved };
            leaderBoardRecords.push(lbObj);
          }
        }
        leaderBoardRecords.sort((a, b) =>  b.totalNamesSolved - a.totalNamesSolved);
        console.log("Current leaderboard records:");
        console.log(leaderBoardRecords);
        return leaderBoardRecords;
      } 
      return [];
    });

    this._channel = useChannel<RealtimeMessage>({
      name: 'events',
      onMessage: (msg) => {
        const payload = msg.payload;

        if(msg.type == PayloadType.SubmittedName) { //TODO: Add points for user, and sync to Redis.
          const praiseMessage = praiseMessages[Math.floor(Math.random() * praiseMessages.length) ];
          const pl = msg.payload as UserSubmittedName;      
          this.pushStatusMessage(pl.username+" submitted the name: "+ pl.name.toLocaleUpperCase()+". "+ praiseMessage, false );
        }
        else if (msg.type == PayloadType.NewNamesAndLetters ){
          const nl = msg.payload as namesAndLetters;
          this.namesAndLetters = nl;        
          this.pushStatusMessage("Which two character names can you make out of "+nl.letters.toUpperCase()+" ?", false );

          let dateNow = new Date();
          const remainingTimeMillis = this._namesAndLettersObj[0].expireTimeMillis - dateNow.getTime();
          const UGS:UserGameState = {userSelectedLetters:'', userLetters: nl.letters, remainingTimeInSeconds: remainingTimeMillis/1000, totalNamesSolved: this.userGameStatus.totalNamesSolved };
          this.userGameStatus = UGS;
        }
        else if  (msg.type == PayloadType.TriggerShowAnswer) {
          this.pushStatusMessage("Answer: Two names were: "+this.namesAndLetters.names[0].toUpperCase() +" and "+this.namesAndLetters.names[1].toUpperCase(), false );          
        }
      },
    });

    this._channel.subscribe();
  }

  public async pushStatusMessage(message:string, updateRedis:boolean = false){
    var messages = this.statusMessages;
    messages.push(message);
    if( messages.length > MaxMessagesCount) {
      messages.shift();//Remove last message if we already have 10 messages.
    }
    this.statusMessages =  messages;
    if( updateRedis ) {
      await this.redis.set('statusMessages', JSON.stringify(messages), {expiration: expireTime});
    }
  }

  public hideLeaderboardBlock() {
    this.currPage = Pages.Game;
  }

  public showLeaderboardBlock() {
    this.currPage = Pages.LeaderBoard;
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

  public set leaderBoardRec(value: leaderBoard[]) {
    this._leaderBoardRec[0] = value;
    this._leaderBoardRec[1](value);
  }

  public get leaderBoardRec() {
    return this._leaderBoardRec[0];
  }

  public get currPage() {
    return this._currPage[0];
  }

  public set currPage(value: Pages) {
    this._currPage[0] = value;
    this._currPage[1](value);
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

  public async refreshUserLetters() {
    const namesAndLettersJson = await this.redis.get('namesAndLetters');
    if ( namesAndLettersJson && namesAndLettersJson.length > 0) {
      const namesAndLettersObj = JSON.parse(namesAndLettersJson);
      const nl = namesAndLettersObj as namesAndLetters;
      let dateNow = new Date();
      const remainingTimeMillis = this._namesAndLettersObj[0].expireTimeMillis - dateNow.getTime();
      this.namesAndLetters = nl;
      var ugs = this.userGameStatus;//Reset selected letters for this user.
      ugs.userLetters = nl.letters;
      ugs.userSelectedLetters = "";
      ugs.remainingTimeInSeconds = remainingTimeMillis/1000;
      this.userGameStatus = ugs;
      this.pushStatusMessage("Which two character names can you make out of "+nl.letters.toUpperCase()+" ?", false );
    }
  } 

  public async isNamesAndLettersStale() {
    const namesAndLettersJson = await this.redis.get('namesAndLetters');
    if ( namesAndLettersJson && namesAndLettersJson.length > 0) {//Cancel previous job if it exists.
      const namesAndLettersObj = JSON.parse(namesAndLettersJson);
      const nl = namesAndLettersObj as namesAndLetters;
      
      if( nl.letters != this.namesAndLetters.letters ) {
        //Update the current names and letters object.
        this.namesAndLetters = nl;
        return true;
      }
      else {
        return false;
      }
    }
    return false;
  }

  public async verifyName(){

    const an = await this.getAnsweredNames();
    const isStale = await this.isNamesAndLettersStale();

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

      if( ! alreadyAnswered ) {//TODO: Add points for user.
        this._context.ui.showToast({
          text: "That's a correct name, congratulations!",
          appearance: 'success',
        });

        const ugs = this.userGameStatus;    
        ugs.totalNamesSolved = ugs.totalNamesSolved + 1;
        const leaderBoardArray = this.leaderBoardRec;
        const leaderBoardObj:leaderBoard  = { username:this.currentUsername, totalNamesSolved: this.userGameStatus.totalNamesSolved};
        var foundIndex = leaderBoardArray.findIndex(x => x.username == this.currentUsername);

        if( foundIndex >= 0 ) {//Update in place
          leaderBoardArray[foundIndex] = leaderBoardObj;
        }
        else {
          leaderBoardArray.push(leaderBoardObj);
        }

        leaderBoardArray.sort((a, b) =>  b.totalNamesSolved - a.totalNamesSolved);
        this.leaderBoardRec = leaderBoardArray;
        await this.redis.hSet(this.myPostId, { [this.currentUsername]: JSON.stringify(leaderBoardObj) });
        await this.redis.expire(this.myPostId, redisExpireTimeSeconds);
        this.userGameStatus = ugs;
      }

      if( ! isStale ) {
        const pl:UserSubmittedName = { name:this.userGameStatus.userSelectedLetters, username: this.currentUsername};
        const rm: RealtimeMessage = { payload: pl, type: PayloadType.SubmittedName};
        await this._channel.send(rm);
        this.resetSelectedLetters();
        const praiseMessage = praiseMessages[Math.floor(Math.random() * praiseMessages.length) ];      
        pushStatusMessageGlobal(pl.username+" submitted the name: "+ pl.name.toLocaleUpperCase()+". "+ praiseMessage, this._context);

        an.names.push(pl);
        if( an.names.length == this.namesAndLetters.names.length ) {//All names are already answered. Time to change the names and letters.
          const nl:namesAndLetters = getRandomNamesAndLetters();
          await this.redis.set('namesAndLetters',  JSON.stringify(nl), {expiration: expireTime});
          const rm: RealtimeMessage = { payload: nl, type: PayloadType.NewNamesAndLetters};
          await this._channel.send(rm);
          await this.redis.del('answeredNames');   
          pushStatusMessageGlobal("Which two character names can you make out of "+nl.letters.toUpperCase()+" ?", this._context );

          createChangeLettersThread(this._context);//Recreate the change-letters thread freshly so that new question does not get removed before answering.
        }
        else {//add to answered names list in redis.
          await this.redis.set('answeredNames',  JSON.stringify(an), {expiration: expireTime});
        }
      }
      else{ //Refresh the namesandletters object with the present one.
        await this.refreshUserLetters();
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
      title: "Which "+showTitle+" character names can you make out of the given letters? [Unscramble Game]",
      subredditName: subreddit.name,
      preview: (
        <vstack width={'100%'} height={'100%'} alignment="center middle">
        <image
          url="loading.gif"
          description="Loading ..."
          height={'140px'}
          width={'140px'}
          imageHeight={'240px'}
          imageWidth={'240px'}
        />
        <spacer size="small" />
        <text size="large" weight="bold">
          Loading Unscramble post...
        </text>
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
    const {currentPage, currentItems, toNextPage, toPrevPage} = usePagination(_context, game.leaderBoardRec, leaderBoardPageSize);
    let cp: JSX.Element[];

    const openUserPage = async (username: string) => {
      _context.ui.navigateTo(`https://www.reddit.com/user/${username}/`);
    };

    const letterCells = game.userGameStatus.userLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor={letterBorderColour} cornerRadius="small" onPress={() => game.addCharacterToSelected(index)}>
          <text size="large" color="black" weight="bold">{letter.toUpperCase()}</text>
        </vstack>
        <spacer size="xsmall" />
      </>
    ));

    const selectedLetterCells = game.userGameStatus.userSelectedLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor={letterBorderColour} cornerRadius="small" onPress={() => game.removeCharacter(index)}>
          <text size="large" color="black" weight="bold">{letter.toUpperCase()}</text>
        </vstack>
      <spacer size="xsmall" />
      </>
    ));

    const SelectedLettersBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack>
        <text size="medium" weight='bold' color={textColour}>Selected letters:</text>
        <vstack alignment="start middle" width="312px" border="thin" borderColor={borderColour} padding='small' minHeight="85px" >
          
          {game.userGameStatus.userSelectedLetters.length == 0 ? <text size="medium" color={textColour} height="30px">None</text>: ""}
          {splitArray(selectedLetterCells, 10).map((row) => ( <>
            <hstack>{row}</hstack>
            <spacer size="xsmall" />
          </>
          ))}
          <spacer size="small" />
          <hstack alignment="center middle" width="100%">
            <button size="small" icon='approve' onPress={() => game.verifyName()}>Submit</button> <spacer size="small" />
            <button size="small" icon='undo' onPress={() => game.resetSelectedLetters()}>Reset</button>
          </hstack>
        </vstack>
      </vstack>
      );

    console.log("here are the random names:");
    console.log(game.names);

    const GameBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack alignment="center middle">
        <text style="heading" size="large" weight='bold' alignment="center middle" color={textColour} width="330px" height="45px" wrap>
          Which two character names can you make out of these letters?
        </text>
        <spacer size="xsmall" />

        <text style="heading" size="small" weight='bold' alignment="center middle" color={textColour} width="312px" wrap>
          Click on the letters to select.
        </text>
        <vstack alignment="top start" width="312px" border="thin" borderColor={borderColour} padding='small' minHeight="80px">
          {splitArray(letterCells, 10).map((row) => ( <>
            <hstack>{row}</hstack>
            <spacer size="xsmall" />
          </>
          ))}
        </vstack>
        <spacer size="xsmall" />
        <SelectedLettersBlock game={game} />

        <spacer size="small" />  
        <text style="heading" size="medium" weight='bold' color={textColour} alignment="start" width="100%">
          Game Activity Feed:
        </text>
        <vstack borderColor={borderColour} padding='xsmall' height="165px" width="330px" backgroundColor='white'>
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
    );
    
    const LeaderBoardBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack width="344px" height="94%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="96%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="275px" color='black'>
                &nbsp;&nbsp;&nbsp;&nbsp;Leaderboard
            </text>
            <button size="small" icon='close' width="34px" onPress={() => game.hideLeaderboardBlock()}></button>
          </hstack>
          <hstack padding="small" width="100%" backgroundColor="#c0c0c0" height="8%">
            <text style="heading" size="small" color="black" width="15%">
             Rank
            </text>
            <text style="heading" size="small" color="black" width="50%">
             Username
            </text>
            <text style="heading" size="small" color="black" width="30%" alignment="start">
              Total Names
            </text>
          </hstack>
          <vstack width="100%" padding="small" height="70%">
            {
            currentItems.map((row, index) => (
            <LeaderBoardRow row={row} index={index + 1 + (currentPage * leaderBoardPageSize )} game={game} />
            ))}
            {game.leaderBoardRec.length == 0 ?<text style="body" size="small" color="black" width="100%" alignment="middle" wrap>
              The leaderboard is empty. You could be the first, close this and start the game!
            </text>:""}
          </vstack>
          <hstack alignment="middle center" width="100%" height="10%">
            <button size="small" onPress={toPrevPage} icon="left"/>
            <spacer size="xsmall" /><text alignment="middle" color="black"> Page: {currentPage + 1}</text><spacer size="xsmall" />
            <button size="small" onPress={toNextPage} icon="right"/>
            <spacer size="small" />
            <button size="small" icon='close' onPress={() => game.hideLeaderboardBlock()}>Close</button>
          </hstack>
          <spacer size="small" />
        </vstack>
      </vstack>
    );

    const LeaderBoardRow = ({row, index, game}: {row: leaderBoard, index: number,  game: UnscrambleGame }): JSX.Element => {
      return (<hstack padding="xsmall">
          <text style="body" size="small" weight="bold" color="black" width="15%">
            {index}
          </text>
          <text style="body" size="small" weight="bold" color="black" onPress={() => openUserPage(row.username)} width="50%">
            {row.username}
          </text>
          <text style="body" size="small" color="black" width="30%" alignment="start">
            &nbsp;{row.totalNamesSolved}
          </text>
        </hstack>
      );
    };


    cp = [  <GameBlock game={game} />,
      <LeaderBoardBlock game={game} />
      //<HelpBlock game={game} />,
     ];

    return (
    <blocks height="tall">
      <vstack alignment="center middle" width="100%" height="100%">
        <vstack height="100%" width="344px" alignment="center top" padding="medium" backgroundColor='#395654' cornerRadius="small">
          {cp[game.currPage]}
          <spacer size="xsmall" />
          <hstack alignment="center middle" width="100%">
            <button size="small" icon='list-numbered' onPress={() => game.showLeaderboardBlock()}>Leaderboard</button> 
            <spacer size="small" />
            <button size="small" icon='help'>Help</button>
          </hstack>
        </vstack>
      </vstack>
    </blocks>
    );
  },
});

export default Devvit;



