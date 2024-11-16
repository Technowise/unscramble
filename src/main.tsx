import { Devvit, ContextAPIClients, RedisClient, UIClient, UseStateResult, useChannel, UseChannelResult, TriggerContext, JobContext, useForm} from '@devvit/public-api';
import { usePagination } from '@devvit/kit';
Devvit.configure({
  redditAPI: true,
  realtime: true,
  redis: true,
});

enum PayloadType {
  SubmittedWord,
  NewWordsAndLetters,
  TriggerShowAnswer
}

type wordsAndLetters = {
  letters: string;
  words: string[];
  expireTimeMillis: number;
};

type UserGameState = {
  userSelectedLetters: string;
  userLetters: string;
  remainingTimeInSeconds: number
  totalWordsSolved: number;
}

type UserSubmittedWord = {
  word: string;
  username: string;
};

type answeredWords = {
  words: UserSubmittedWord[];
};

type ShowAnswer = {
};

type RealtimeMessage = {
  payload: UserSubmittedWord | wordsAndLetters| ShowAnswer;
  type: PayloadType;
};

type leaderBoard = {
  username: string;
  totalWordsSolved: number;
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

const MaxMessagesCount = 5;
const leaderBoardPageSize = 12;
const praiseMessages = ["Good job! 👍🏼", "Well done! ✅"];
const redisExpireTimeSeconds = 2592000;//30 days in seconds.

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
    const wordsTitle = await getWordsTitleFromRedis(context);

    //Get old words and letters from redis.
    const wordsAndLettersJson = await context.redis.get('wordsAndLetters');
    if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {//Cancel previous job if it exists.
      const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
      const nl = wordsAndLettersObj as wordsAndLetters;
      pushStatusMessageGlobal("Answer: Two words were: "+nl.words[0].toUpperCase() +" and "+nl.words[1].toUpperCase(), context );
    }

    const wordsAndLettersObj:wordsAndLetters = await getRandomWordsAndLetters(context);
    await context.redis.set('wordsAndLetters',  JSON.stringify(wordsAndLettersObj), {expiration: expireTime});
    const rm: RealtimeMessage = { payload: wordsAndLettersObj, type: PayloadType.NewWordsAndLetters};
    await context.realtime.send('events', rm);
    pushStatusMessageGlobal("Which two "+wordsTitle+" can you make out of "+wordsAndLettersObj.letters.toUpperCase()+" ?", context );
    await context.redis.expire('changeLettersJobId', redisExpireTimeSeconds);//Extend expire time for keys that are necessary for app.
    await context.redis.expire('words', redisExpireTimeSeconds);
    await context.redis.expire('wordsTitle', redisExpireTimeSeconds);
    await context.redis.expire('minutesToSolve', redisExpireTimeSeconds);
    await context.redis.del('answeredWords');
  },
});

async function createChangeLettersThread(context:TriggerContext| ContextAPIClients) {
  const minutesToSolve = await getMinutesToSolveFromRedis(context);
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

async function getWordsFromRedis(context:TriggerContext| ContextAPIClients) {
  const wordsStr = await context.redis.get('words');
  if( wordsStr && wordsStr.length > 0 ) {
    var wordsArray = wordsStr.split(",").map(function (value) {
      return value.trim();
   });
   return wordsArray;
  }
  else
  {
    return [];
  }
}

async function getMinutesToSolveFromRedis(context:TriggerContext| ContextAPIClients) {
  const minutesStr = await context.redis.get('minutesToSolve');
  if( minutesStr && minutesStr.length > 0 ) {
   return parseInt(minutesStr);
  }
  else
  {
    return 2;//Default to two minutes.
  }
}

async function getWordsTitleFromRedis(context:TriggerContext| ContextAPIClients) {
  const wordsStr = await context.redis.get('wordsTitle');
  if( wordsStr && wordsStr.length > 0 ) {
   return wordsStr;
  }
  else {
    return "";
  }
}

async function getRandomWordsAndLetters(context:TriggerContext| ContextAPIClients) {
  const words = await getWordsFromRedis(context);
  const minutesToSolve = await getMinutesToSolveFromRedis(context);
  const lettersExpireTimeSeconds = minutesToSolve * 60;
  var word1index = Math.floor(Math.random() * words.length);
  var word2index = Math.floor(Math.random() * words.length);

  while( word2index == word1index) {//Make sure we do not end up with same words.
    word2index = Math.floor(Math.random() * words.length);
  }

  var allLetters = words[word1index] + words[ word2index];
  var shuffledLetters = allLetters.split('').sort(function(){return 0.5-Math.random()}).join('');
  let dateNow = new Date();
  const milliseconds = lettersExpireTimeSeconds * 1000;
  var lettersExpireTimeMillis = dateNow.getTime();
  lettersExpireTimeMillis = lettersExpireTimeMillis + milliseconds;
  const wl:wordsAndLetters = {words: [ words[word1index], words[word2index] ], letters: shuffledLetters, expireTimeMillis: lettersExpireTimeMillis };
  return wl;
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
  private _wordsAndLettersObj:UseStateResult<wordsAndLetters>;
  private _userGameStatus: UseStateResult<UserGameState>;
  private _statusMessages: UseStateResult<string[]>;
  private _channel: UseChannelResult<RealtimeMessage>;
  private _leaderBoardRec:UseStateResult<leaderBoard[]>;
  private _currPage: UseStateResult<Pages>;
  private _allWords: UseStateResult<string[]>;
  private _wordsTitle: UseStateResult<string>;
  private _minutesToSolve: UseStateResult<number>;
  
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
      return messages;
    });

    this._allWords = context.useState(async () => {
      const words = await getWordsFromRedis(context);
      return words;
    });

    this._wordsTitle = context.useState(async () => {
      const wordsTitle = await this.redis.get('wordsTitle');
      if(wordsTitle && wordsTitle.length > 0 ) {
        return wordsTitle;
      }
      return "";
    });

    this._minutesToSolve = context.useState(async () => {
      const minutes = await getMinutesToSolveFromRedis(context);
      return minutes;
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

    this._wordsAndLettersObj = context.useState<wordsAndLetters>(
      async() =>{
        const wordsAndLettersJson = await this.redis.get('wordsAndLetters');
        if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {//Cancel previous job if it exists.
          const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
          const nl = wordsAndLettersObj as wordsAndLetters;
          return nl;
        }
        else {
          const nl:wordsAndLetters = await getRandomWordsAndLetters(context);
          await context.redis.set('wordsAndLetters',  JSON.stringify(nl), {expiration: expireTime});
          return nl;
        }
      }
    );

    this._userGameStatus = context.useState<UserGameState>(
      async() =>{
        let dateNow = new Date();
        const remainingTimeMillis = this._wordsAndLettersObj[0].expireTimeMillis - dateNow.getTime();
        const UGS:UserGameState = {userSelectedLetters:'', userLetters: this._wordsAndLettersObj[0].letters, remainingTimeInSeconds: remainingTimeMillis/1000, totalWordsSolved:0 };
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
              usg.totalWordsSolved = redisLBObj.totalWordsSolved;
              this.userGameStatus = usg;
            }
            const lbObj:leaderBoard = {username: redisLBObj.username, totalWordsSolved:redisLBObj.totalWordsSolved };
            leaderBoardRecords.push(lbObj);
          }
        }
        leaderBoardRecords.sort((a, b) =>  b.totalWordsSolved - a.totalWordsSolved);
        return leaderBoardRecords;
      } 
      return [];
    });

    this._channel = useChannel<RealtimeMessage>({
      name: 'events',
      onMessage: (msg) => {
        const payload = msg.payload;

        if(msg.type == PayloadType.SubmittedWord) {
          const praiseMessage = praiseMessages[Math.floor(Math.random() * praiseMessages.length) ];
          const pl = msg.payload as UserSubmittedWord;      
          this.pushStatusMessage(pl.username+" submitted the word: "+ pl.word.toLocaleUpperCase()+". "+ praiseMessage, false );
        }
        else if (msg.type == PayloadType.NewWordsAndLetters ){
          const nl = msg.payload as wordsAndLetters;
          this.wordsAndLetters = nl;        
          this.pushStatusMessage("Which two "+this.wordsTitle+" can you make out of "+nl.letters.toUpperCase()+" ?", false );

          let dateNow = new Date();
          const remainingTimeMillis = this._wordsAndLettersObj[0].expireTimeMillis - dateNow.getTime();
          const UGS:UserGameState = {userSelectedLetters:'', userLetters: nl.letters, remainingTimeInSeconds: remainingTimeMillis/1000, totalWordsSolved: this.userGameStatus.totalWordsSolved };
          this.userGameStatus = UGS;
        }
        else if  (msg.type == PayloadType.TriggerShowAnswer) {
          this.pushStatusMessage("Answer: Two words were: "+this.wordsAndLetters.words[0].toUpperCase() +" and "+this.wordsAndLetters.words[1].toUpperCase(), false );          
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

  public showHelpBlock() {
    this.currPage = Pages.Help;
  }

  public hideHelpBlock() {
    this.currPage = Pages.Game;
  }

  public resetSelectedLetters() {
    var ugs = this.userGameStatus;//Reset selected letters for this user.
    ugs.userLetters = this.userGameStatus.userLetters + this.userGameStatus.userSelectedLetters;
    ugs.userSelectedLetters = "";
    this.userGameStatus = ugs;
  }

  public addLetterToSelected(index:number) {
    var ugs:UserGameState = this.userGameStatus;
    ugs.userSelectedLetters = ugs.userSelectedLetters + ugs.userLetters[index];
    var letters = Array.from(ugs.userLetters);
    letters.splice(index, 1);
    ugs.userLetters = letters.join('');
    this.userGameStatus = ugs;
  }

  public removeLetter(index:number) {
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
    return this._wordsAndLettersObj[0].letters;
  }

  public get words() {
    return this._wordsAndLettersObj[0].words;
  }

  public get allWords() {
    return this._allWords[0];
  }

  public get wordsTitle() {
    return this._wordsTitle[0];
  }

  public get minutesToSolve(){
    return this._minutesToSolve[0];
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

  public get wordsAndLetters() {
    return this._wordsAndLettersObj[0];
  }

  public set wordsAndLetters(value: wordsAndLetters) {
    this._wordsAndLettersObj[0] = value;
    this._wordsAndLettersObj[1](value);
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

  public async getAnsweredWords() {
    const answeredWordsJson = await this.redis.get('answeredWords');
    if( answeredWordsJson && answeredWordsJson.length > 0 ) {
      const answeredWordsObj = JSON.parse(answeredWordsJson);
      const an = answeredWordsObj as answeredWords;
      return an;
    }
    else {
      const an:answeredWords = {words:[]}
      return an;
    }
  }

  public async refreshUserLetters() {
    const wordsAndLettersJson = await this.redis.get('wordsAndLetters');
    if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {
      const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
      const nl = wordsAndLettersObj as wordsAndLetters;
      let dateNow = new Date();
      const remainingTimeMillis = this._wordsAndLettersObj[0].expireTimeMillis - dateNow.getTime();
      this.wordsAndLetters = nl;
      var ugs = this.userGameStatus;//Reset selected letters for this user.
      ugs.userLetters = nl.letters;
      ugs.userSelectedLetters = "";
      ugs.remainingTimeInSeconds = remainingTimeMillis/1000;
      this.userGameStatus = ugs;
      this.pushStatusMessage("Which two "+this.wordsTitle+" can you make out of "+nl.letters.toUpperCase()+" ?", false );
    }
  } 

  public async iswordsAndLettersStale() {
    const wordsAndLettersJson = await this.redis.get('wordsAndLetters');
    if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {//Cancel previous job if it exists.
      const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
      const nl = wordsAndLettersObj as wordsAndLetters;
      
      if( nl.letters != this.wordsAndLetters.letters ) {
        this.wordsAndLetters = nl;
        return true;
      }
      else {
        return false;
      }
    }
    return false;
  }

  public async verifyWord(){
    const an = await this.getAnsweredWords();
    const isStale = await this.iswordsAndLettersStale();
    var alreadyAnswered = false;

    if( this.allWords.includes(this.userGameStatus.userSelectedLetters) ) {

      //Check if the submitted name was already answered by someone.
      var foundIndex = an.words.findIndex(x => x.word == this.userGameStatus.userSelectedLetters);
      if( foundIndex >= 0 ) {
        alreadyAnswered = true;
        this._context.ui.showToast({
          text: "This name was already answered by /u/"+an.words[foundIndex].username,
          appearance:"neutral",
        });       
      }

      if( ! alreadyAnswered ) {
        this._context.ui.showToast({
          text: "That's correct, congratulations!",
          appearance: 'success',
        });

        const ugs = this.userGameStatus;    
        ugs.totalWordsSolved = ugs.totalWordsSolved + 1;
        const leaderBoardArray = this.leaderBoardRec;
        const leaderBoardObj:leaderBoard  = { username:this.currentUsername, totalWordsSolved: this.userGameStatus.totalWordsSolved};
        var foundIndex = leaderBoardArray.findIndex(x => x.username == this.currentUsername);

        if( foundIndex >= 0 ) {//Update in place
          leaderBoardArray[foundIndex] = leaderBoardObj;
        }
        else {
          leaderBoardArray.push(leaderBoardObj);
        }

        leaderBoardArray.sort((a, b) =>  b.totalWordsSolved - a.totalWordsSolved);
        this.leaderBoardRec = leaderBoardArray;
        await this.redis.hSet(this.myPostId, { [this.currentUsername]: JSON.stringify(leaderBoardObj) });
        await this.redis.expire(this.myPostId, redisExpireTimeSeconds);
        this.userGameStatus = ugs;
      }

      if( ! isStale && !alreadyAnswered  ) {
        const pl:UserSubmittedWord = { word:this.userGameStatus.userSelectedLetters, username: this.currentUsername};
        const rm: RealtimeMessage = { payload: pl, type: PayloadType.SubmittedWord};
        await this._channel.send(rm);
        this.resetSelectedLetters();
        const praiseMessage = praiseMessages[Math.floor(Math.random() * praiseMessages.length) ];      
        pushStatusMessageGlobal(pl.username+" submitted the word: "+ pl.word.toLocaleUpperCase()+". "+ praiseMessage, this._context);

        an.words.push(pl);
        if( an.words.length == this.wordsAndLetters.words.length ) {//All words are already answered. Time to change the words and letters.
          const nl:wordsAndLetters = await getRandomWordsAndLetters(this._context);
          await this.redis.set('wordsAndLetters',  JSON.stringify(nl), {expiration: expireTime});
          const rm: RealtimeMessage = { payload: nl, type: PayloadType.NewWordsAndLetters};
          await this._channel.send(rm);
          await this.redis.del('answeredWords');   
          pushStatusMessageGlobal("Which two "+this.wordsTitle+" can you make out of "+nl.letters.toUpperCase()+" ?", this._context );
          createChangeLettersThread(this._context);//Recreate the change-letters thread freshly so that new question does not get removed before answering.
        }
        else {//add to answered words list in redis.
          await this.redis.set('answeredWords',  JSON.stringify(an), {expiration: expireTime});
        }
      }
      else if( isStale && !alreadyAnswered){ //Refresh the wordsAndLetters object with the present one.
        await this.refreshUserLetters();
      }
    }
    else {
      this._context.ui.showToast({
        text: "Sorry, that's not a correct!",
        appearance: 'neutral',
      });      
    }
  }

}

const wordsInputForm = Devvit.createForm(  (data) => {
  return {
    title : "Create a Unscramble Game post",
    description:"Use of browser/desktop view is recommended for creating new posts.",
    acceptLabel: "Submit",
    fields: [
      {
        name: 'words',
        label: 'Enter comma separated list of words',
        type: 'paragraph',
        helpText:'Comma separated list of words for the Unscramble Game'
      },
      {
        name: 'wordsTitle',
        label: 'Title for the list of words',
        type: 'string',
        helpText: 'Title for the above list of words (example: South Park character names, Javascript keywords etc.)',
      },
      {
        name: 'minutesToSolve',
        label: 'Minutes to solve the letters',
        type: 'number',
        helpText: 'Max number of minutes allowed to solve each set of scrambled/jumbled letters.',
        defaultValue: 3
      },
      {
        type: 'select',
        name: 'flair',
        label: 'Flair',
        options: data.flairOptions,
        helpText: "Select a flair for your post.",
        required: data.flairOptions.length > 0 ? true: false,
      },
    ],
  };
  },
  async (event, context) => {// onSubmit handler
    const ui  = context.ui;
    const reddit = context.reddit;
    const subreddit = await reddit.getCurrentSubreddit();
    const submittedWords = event.values.words;
    const submittedWordsTitle = event.values.wordsTitle;
    const minutesToSolve = event.values.minutesToSolve;
    const flairId = event.values.flair ? event.values.flair[0] : null;

    const post = await reddit.submitPost({
      title: "Which "+submittedWordsTitle+" can you make out of the given letters? [Unscramble-Game]",
      subredditName: subreddit.name,
      flairId: flairId,
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

    const {redis} = context;

    await redis.set('words', submittedWords, {expiration: expireTime} );
    await redis.set('wordsTitle', submittedWordsTitle, {expiration: expireTime});
    await redis.set('minutesToSolve', minutesToSolve.toString(), {expiration: expireTime});
  
    ui.showToast({
      text: `Successfully created an Unscramble game post!`,
      appearance: 'success',
    });
    context.ui.navigateTo(post.url);
  } );

Devvit.addMenuItem({
  label: 'Create Unscramble Game post',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_, context) => {
    await showCreatePostForm(context);
  },
});

async function showCreatePostForm(context:ContextAPIClients) {
  const subreddit = await context.reddit.getCurrentSubreddit();
  const flairTemplates = await subreddit.getPostFlairTemplates();
  const options = flairTemplates.map(template => {
    return { label: template.text, value: template.id };
  });
  
  context.ui.showForm(wordsInputForm, {flairOptions: options});
}

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
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor={letterBorderColour} cornerRadius="small" onPress={() => game.addLetterToSelected(index)}>
          <text size="large" color="black" weight="bold">{letter.toUpperCase()}</text>
        </vstack>
        <spacer size="xsmall" />
      </>
    ));

    const selectedLetterCells = game.userGameStatus.userSelectedLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor={letterBorderColour} cornerRadius="small" onPress={() => game.removeLetter(index)}>
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
            <button size="small" icon='approve' onPress={() => game.verifyWord()}>Submit</button> <spacer size="small" />
            <button size="small" icon='undo' onPress={() => game.resetSelectedLetters()}>Reset</button>
          </hstack>
        </vstack>
      </vstack>
      );

    const GameBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack alignment="center middle" border='none'>
        <text style="heading" size="large" weight='bold' alignment="center middle" color={textColour} width="330px" height="45px" wrap>
          Tap/click letters below to make {game.wordsTitle}
        </text>
        <spacer size="xsmall" />

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
        <text style="heading" size="medium" weight='bold' color={textColour} alignment="start" width="312px">
          Game Activity Feed:
        </text>
        <vstack borderColor={borderColour} padding='xsmall' height="182px" width="312px" backgroundColor='white'>
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
          <hstack padding="small" alignment="middle center" width="100%">
            <text style="heading" size="large" weight='bold' alignment="middle center" color='black'>
                Leaderboard
            </text>
          </hstack>
          <hstack padding="small" width="100%" backgroundColor="#c0c0c0" height="8%">
            <text style="heading" size="small" color="black" width="15%">
             Rank
            </text>
            <text style="heading" size="small" color="black" width="50%">
             Username
            </text>
            <text style="heading" size="small" color="black" width="30%" alignment="start">
              Total Words
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
            &nbsp;{row.totalWordsSolved}
          </text>
        </hstack>
      );
    };

    const HelpBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack  width="344px" height="94%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
        <hstack padding="small" width="100%">
          <text style="heading" size="large" weight='bold' alignment="middle center" width="100%" color='black'>
              Help 
          </text>
        </hstack>
        <vstack height="82%" width="100%" padding="medium">
          <spacer size="small" />
          <hstack alignment='start middle'>
            <icon name="search" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; How to play Unscramble Game
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            This is a game of unscrambling {game.wordsTitle}. Each set of letters contains a minimum of two {game.wordsTitle} scrambled together. Tap/click on the letters to select, and click on submit after the word is completed.
            New set of scrambled letters are presented after both the words are solved, or after {game.minutesToSolve} minute(s).
          </text>
          <spacer size="small" />
          <hstack alignment='start middle'>
            <icon name="list-numbered" size="xsmall" color='black'></icon>
            <text style="heading" size="medium" color='black'>
              &nbsp; View leaderboard.
            </text>
          </hstack>
          <text style="body" wrap size="medium" color='black'>
            You can view how many words each participant has solved by clicking on `Leaderboard` button.
          </text> 
          <spacer size="small" />
        </vstack>
        <hstack alignment="bottom center" width="100%" height="8%">
          <button size="small" icon='close' onPress={() => game.hideHelpBlock()}>Close</button>
        </hstack>
      </vstack>
    );

    cp = [ <GameBlock game={game} />,
      <LeaderBoardBlock game={game} />,
      <HelpBlock game={game} />,
     ];

    return (
    <blocks height="tall">
      <vstack alignment="center middle" width="100%" height="100%">
        <vstack height="100%" width="344px" alignment="center top" padding="medium" backgroundColor='#395654' borderColor='#395654' cornerRadius="small">
          {cp[game.currPage]}
          <spacer size="xsmall" />
          <hstack alignment="center middle" width="100%">
            <button size="small" icon='list-numbered' onPress={() => game.showLeaderboardBlock()}>Leaderboard</button> 
            <spacer size="small" />
            <button size="small" icon='help'  onPress={() => game.showHelpBlock()}>Help</button>
          </hstack>
        </vstack>
      </vstack>
    </blocks>
    );
  },
});

export default Devvit;
