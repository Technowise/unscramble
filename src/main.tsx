import { Devvit, ContextAPIClients, RedisClient, UseStateResult, useInterval, useChannel, UseChannelResult, TriggerContext, JobContext, useForm, UseIntervalResult} from '@devvit/public-api';
import { usePagination } from '@devvit/kit';
Devvit.configure({
  redditAPI: true,
  realtime: true,
  redis: true,
});

enum PayloadType {
  SubmittedWord,
  NewWordsAndLetters,
  TriggerShowAnswer,
  TriggerRefreshWords,
  TriggerShowHint
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

type CurrentUserInfo = {
  username: string;
  isUserModerator: boolean;
  isUserBanned: boolean;
}

type UserSubmittedWord = {
  word: string;
  username: string;
};

type webviewDataRequest = {
  type: string;
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

type postArchive = {
  words: string[],
  leaderboard: leaderBoard[]
}

export enum Pages {
  Game,
  LeaderBoard,
  Help,
  GameEnd,
}

function splitArray<T>(array: T[], segmentLength: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += segmentLength) {
    result.push(array.slice(i, i + segmentLength));
  }
  return result;
}

const MaxMessagesCount = 10;
const leaderBoardPageSize = 12;
const praiseMessages = ["Good job! 👍🏼", "Well done! ✅"];
const redisExpireTimeSeconds = 2592000;//30 days in seconds.

let dateNow = new Date();
const milliseconds = redisExpireTimeSeconds * 1000;
const expireTime = new Date(dateNow.getTime() + milliseconds);
const textColour = 'white';
const borderColour = "#7fa78c";
const letterBorderColour = 'black';
const gameTitle = "Unscramble-Game";

Devvit.addSchedulerJob({
  name: 'change_letters_job',  
  onRun: async(event, context) => {
    var myPostId = event.data!.postId as string;
    console.log("running change_letters_job for post: "+myPostId);
    cancelHowHintScheduledJob(context, myPostId);//Cancel previous show-hint job if it exists.
    const rms: RealtimeMessage = { payload: {}, type: PayloadType.TriggerShowAnswer};
    await context.realtime.send(myPostId+'events', rms);
    const wordsCount = await getWordsCountFromRedis(context, myPostId);

    //Get old words and letters from redis.
    const wordsAndLettersJson = await context.redis.get(myPostId+'wordsAndLetters');
    if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {//Cancel previous job if it exists.
      const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
      const wl = wordsAndLettersObj as wordsAndLetters;
      pushStatusMessageGlobal("Answer: "+ wl.words.join(", ") , context, myPostId );
    }

    const wordsAndLettersObj:wordsAndLetters = await getRandomWordsAndLetters(context, myPostId);
    await context.redis.set(myPostId+'wordsAndLetters',  JSON.stringify(wordsAndLettersObj), {expiration: expireTime});
    const rm: RealtimeMessage = { payload: wordsAndLettersObj, type: PayloadType.NewWordsAndLetters};
    await context.realtime.send(myPostId+'events', rm);
    createShowHintJob(context, myPostId);
    pushStatusMessageGlobal("Which "+ (wordsCount == 2? "two words" :"word")+" can you make out of "+wordsAndLettersObj.letters+" ?", context, myPostId );
    await context.redis.expire(myPostId+'changeLettersJobId', redisExpireTimeSeconds);//Extend expire time for keys that are necessary for app.
    await context.redis.expire(myPostId+'words', redisExpireTimeSeconds);
    await context.redis.expire(myPostId+'title', redisExpireTimeSeconds);
    await context.redis.expire(myPostId+'minutesToSolve', redisExpireTimeSeconds);
    await context.redis.expire(myPostId+'showHint', redisExpireTimeSeconds);
    await context.redis.expire(myPostId, redisExpireTimeSeconds);//key for leaderboard hash.
    await context.redis.del(myPostId+'answeredWords');
  },
});

Devvit.addSchedulerJob({
  name: 'show_hint_job',  
  onRun: async(event, context) => {
    var myPostId = event.data!.postId as string;
    console.log("running show_hint job for post: "+myPostId);
    const answeredWordsJson = await context.redis.get(myPostId+'answeredWords');
    if( ! ( answeredWordsJson && answeredWordsJson.length > 0 ) ) {//Trigger show hint only when there are no words answered.
      const rms: RealtimeMessage = { payload: {}, type: PayloadType.TriggerShowHint};
      await context.realtime.send(myPostId+'events', rms);
    }
  },
});

Devvit.addSchedulerJob({
  name: 'post_archive_job',  
  onRun: async(event, context) => {
    var myPostId = event.data!.postId as string;
    await cancelScheduledJobs(context, myPostId);

    var spoilerCommentId = await context.redis.get(myPostId+'spoilerCommentId');

    if( spoilerCommentId && spoilerCommentId.length > 0 ) {//Delete spoiler comment.
      const spoilerComment = await context.reddit.getCommentById(spoilerCommentId);
      await spoilerComment.delete();
    }

    var pa: postArchive = {words: await getWords(context, myPostId), leaderboard: await getLeaderboardRecords(context, myPostId)};
    var archiveCommentJson = JSON.stringify(pa);
    const redditComment = await context.reddit.submitComment({
          id: `${myPostId}`,
          text: archiveCommentJson
        });
    console.log("Created post archive with comment-id:"+redditComment.id );
  },
});

async function createChangeLettersThread(context:TriggerContext| ContextAPIClients, postId:string) {

  await cancelScheduledJobs(context, postId);
  const minutesToSolve = await getMinutesToSolveFromRedis(context, postId);

  try {
    const jobId = await context.scheduler.runJob({
      cron: "*/"+minutesToSolve+" * * * *",
      name: 'change_letters_job',
      data: { 
        postId: postId,
      }
    });
    await context.redis.set(postId+'changeLettersJobId', jobId, {expiration: expireTime});
    console.log("Created job schedule for changeLetters: "+jobId);
    createShowHintJob(context, postId);

  } catch (e) {
    console.log('error - was not able to create job:', e);
    throw e;
  }
}

async function createShowHintJob(context:TriggerContext| ContextAPIClients, postId:string) {

  const shouldShowHint = await context.redis.get(postId+'showHint');

  if( shouldShowHint && shouldShowHint == "true" ) {
    const minutesToSolve = await getMinutesToSolveFromRedis(context, postId);
    const halfTimeSeconds = Math.floor( (minutesToSolve/2) * 60 );
    const halfTimeSecondsMillis = halfTimeSeconds * 1000;
    const dateNow = new Date();
    const showHintRunAt = new Date( dateNow.getTime() + halfTimeSecondsMillis );

    const showHintJobId = await context.scheduler.runJob({
      runAt: showHintRunAt,
      name: 'show_hint_job',
      data: { 
        postId: postId,
      }
    });
    await context.redis.set(postId+'showHintJobId', showHintJobId, {expiration: expireTime});
    console.log("Created job for showHint: "+showHintJobId);
  }
}

async function createPostArchiveSchedule(context:TriggerContext| ContextAPIClients, postId:string) {
  var postExpireTimestamp = await getPostExpireTimestamp(context, postId);  
  try {
    const jobId = await context.scheduler.runJob({
      runAt: new Date(postExpireTimestamp),
      name: 'post_archive_job',
      data: { 
        postId: postId,
      }
    });
    await context.redis.set(postId+'post_archive_job', jobId, {expiration: expireTime});
    console.log("Created job schedule for post_archive_job: "+jobId);
  } catch (e) {
    console.log('error - was not able to create post_archive_job:', e);
    throw e;
  }
}

Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: async (event, context) => {
    const postId = event.post?.id ?? "";
    if( postId != "") {
      if ( await isPostCreatedByCurrentApp(context, postId) ) {
        createChangeLettersThread(context, postId);
        createPostArchiveSchedule(context, postId);
      }
    }
  },
});

async function isPostCreatedByCurrentApp(context: TriggerContext| ContextAPIClients, postId:string) {
  const post = await context.reddit.getPostById(postId);
  const authorId = post.authorId ?? "";
  const author = await context.reddit.getUserById(authorId);
  const appUser = await context.reddit.getAppUser();
  if ( author && author.username === appUser.username) {
    return true;
  } else {
    return false;
  }
}

Devvit.addTrigger({  
  event : 'PostDelete',  
  onEvent: async ( event, context) => {
    const postId = event.postId?? "";
    if ( await isPostCreatedByCurrentApp(context, postId) ) {
      await cancelScheduledJobs(context, postId);
    }
  },
});

async function getLeaderboardRecords(context:TriggerContext| ContextAPIClients, postId:string ) {
  const previousLeaderBoard = await context.redis.hGetAll(postId);
  if (previousLeaderBoard && Object.keys(previousLeaderBoard).length > 0) {
    var leaderBoardRecords: leaderBoard[] = [];
    for (const key in previousLeaderBoard) {
      const redisLBObj = JSON.parse(previousLeaderBoard[key]);
      if( redisLBObj.username ) {
        const lbObj:leaderBoard = {username: redisLBObj.username, totalWordsSolved:redisLBObj.totalWordsSolved };
        leaderBoardRecords.push(lbObj);
      }
    }
    leaderBoardRecords.sort((a, b) =>  b.totalWordsSolved - a.totalWordsSolved);
    return leaderBoardRecords;
  }
  else {//try to get leaderbard records from the archive in comment.
    const redditPostComments = await getRedditPostComments(context, postId);
    for( var i=0; i<redditPostComments.length; i++ ) {
      if( redditPostComments[i].authorName == 'unscramble-game' && redditPostComments[i].body.includes("\"leaderboard\"") ) {
        try {
          var pa = JSON.parse(redditPostComments[i].body);
          const postArchive = pa as postArchive;
          console.log("Retrieved leaderboard records from comment json");
          return postArchive.leaderboard;
        } catch (e) {
          console.log(e);
          continue;//Skip current entry and try next.
        }
      }
    }
  }

  return [];
}

async function getPostExpireTimestamp(context:TriggerContext| ContextAPIClients, postId:string ) {
  const post = await context.reddit.getPostById(postId);
  const totalDurationHours = await context.redis.get(postId+'totalGameDurationHours');
  if( totalDurationHours && totalDurationHours.length  > 0 ) {
    const totalDurationHoursInt = parseInt(totalDurationHours);
    return post.createdAt.getTime() + (totalDurationHoursInt*60*60*1000);
  }
  return 0;//Return zero to indicate that there is no total duration available.
}

async function cancelScheduledJobs(context:TriggerContext| ContextAPIClients, postId:string ){
  const oldJobId = await context.redis.get(postId+'changeLettersJobId');
  if( oldJobId && oldJobId.length > 0 ) {
    await context.scheduler.cancelJob(oldJobId);
    console.log("Deleted scheduled job for the post("+postId+")");
    await context.redis.del(postId+'changeLettersJobId');
  }
  cancelHowHintScheduledJob(context, postId);
}

async function cancelHowHintScheduledJob(context:TriggerContext| ContextAPIClients, postId:string ){
  const oldShowHintJobId = await context.redis.get(postId+'showHintJobId');
  if( oldShowHintJobId && oldShowHintJobId.length > 0 ) {
    await context.scheduler.cancelJob(oldShowHintJobId);
    console.log("Deleted Show Hint job for the post("+postId+")");
    await context.redis.del(postId+'showHintJobId');
  }
}

async function getWords(context:TriggerContext| ContextAPIClients, postId:string) {
  const wordsStr = await context.redis.get(postId+'words');
  if( wordsStr && wordsStr.length > 0 ) {
    console.log("Got words from redis!");
    var wordsArray = wordsStr.split(",").map(function (value) {
      return value.trim();
   });
   return wordsArray;
  }
  else {//get words from the archive in comment.
    console.log("Failed to get words from redis, trying from comments...");
    const redditPostComments = await getRedditPostComments(context, postId);
      let metaCommentObj = redditPostComments.find(i => i.authorName === 'unscramble-game' && i.body.includes("\"leaderboard\"") );
      if( metaCommentObj ) {
        var pa = JSON.parse(metaCommentObj.body); 
        const postArchive = pa as postArchive;
        console.log("Retreived words from comment archive");
        return postArchive.words;
      }
  }
  return [];
}

async function getRedditPostComments(context: TriggerContext| ContextAPIClients, postId:string) {
  const comments = await context.reddit
  .getComments({
    postId: postId,
    limit: 100,
    pageSize: 500,
  })
  .all();
  return comments;
}

async function getMinutesToSolveFromRedis(context:TriggerContext| ContextAPIClients, postId:string) {
  const minutesStr = await context.redis.get(postId+'minutesToSolve');
  if( minutesStr && minutesStr.length > 0 ) {
   return parseInt(minutesStr);
  }
  else {
    return 2;//Default to two minutes.
  }
}

async function getTitleFromRedis(context:TriggerContext| ContextAPIClients, postId:string) {
  const wordsStr = await context.redis.get(postId+'title');
  if( wordsStr && wordsStr.length > 0 ) {
   return wordsStr;
  }
  else {
    return "";
  }
}

async function getWordsCountFromRedis(context:TriggerContext| ContextAPIClients, postId:string) {
  const wordsCountStr = await context.redis.get(postId+'wordsCount');
  if( wordsCountStr && wordsCountStr.length > 0 ) {
    return parseInt(wordsCountStr);
  }
  else {
    return 2;
  }
}

async function getRandomWordsAndLetters(context:TriggerContext| ContextAPIClients, postId:string) {
  const words = await getWords(context, postId);
  const minutesToSolve = await getMinutesToSolveFromRedis(context, postId);
  const wordsCount = await getWordsCountFromRedis(context, postId);
  const lettersExpireTimeSeconds = minutesToSolve * 60;
  var word1index = Math.floor(Math.random() * words.length);
  if( words.length > 0 ) {
    var allLetters = words[word1index].toUpperCase();
    var wordsSet = [ words[word1index].toUpperCase() ];

    if( wordsCount == 2 ) {
      var word2index = Math.floor(Math.random() * words.length);

      while( word2index == word1index) {//Make sure we do not end up with same words.
        word2index = Math.floor(Math.random() * words.length);
      }
    allLetters = allLetters + words[ word2index].toUpperCase();
    wordsSet.push(words[word2index].toUpperCase());
    }

    var shuffledLetters = allLetters;
    while( shuffledLetters == allLetters){//Only loop out when letters are not same as original letters.
      shuffledLetters = allLetters.split('').sort(function(){return 0.5-Math.random()}).join('');
    }

    let dateNow = new Date();
    const milliseconds = lettersExpireTimeSeconds * 1000;
    var lettersExpireTimeMillis = dateNow.getTime();
    lettersExpireTimeMillis = lettersExpireTimeMillis + milliseconds;
    const wl:wordsAndLetters = {words: wordsSet, letters: shuffledLetters, expireTimeMillis: lettersExpireTimeMillis };
    return wl;
  }
  else {
    //Something's wrong, redis did not return the words for this game. TODO: Find the cause and fix this issue.
    const wl:wordsAndLetters = {words: [], letters: "", expireTimeMillis: 0 };
    return wl;
  }
}

//Update messages in redis so that other clients which load messages first time get the messages.
async function pushStatusMessageGlobal(message:string, context:JobContext|ContextAPIClients, postId: string){
  var messages: string[] = [];
  var smJson = await context.redis.get(postId+'statusMessages');
  if( smJson && smJson.length > 0 ) {
    messages = JSON.parse(smJson);
  }
  messages.push(message);
  if( messages.length > MaxMessagesCount) {
    messages.shift();//Remove last message if we already have 10 messages.
  }
  await context.redis.set(postId+'statusMessages', JSON.stringify(messages), {expiration: expireTime});
}

class UnscrambleGame {
  public myPostId: string;
  private _redisKeyPrefix: string;
  private redis: RedisClient;
  private _context: ContextAPIClients;
  private _gameExpireTimeStamp: UseStateResult<number>;
  private _wordsAndLettersObj:UseStateResult<wordsAndLetters>;
  private _userGameStatus: UseStateResult<UserGameState>;
  private _statusMessages: UseStateResult<string[]>;
  private _channel: UseChannelResult<RealtimeMessage>;
  private _leaderBoardRec:UseStateResult<leaderBoard[]>;
  private _currPage: UseStateResult<Pages>;
  private _allWords: UseStateResult<string[]>;
  private _title: UseStateResult<string>;
  private _wordsCount: UseStateResult<number>;
  private _minutesToSolve: UseStateResult<number>;
  private _currentUserInfo: UseStateResult<CurrentUserInfo>;
  private _counterInterval: UseIntervalResult;

  constructor( context: ContextAPIClients, postId: string) {
    this._context = context;
    this.redis = context.redis;
    this.myPostId = postId;
    
    this._statusMessages = context.useState(async () => {
      var messages: string[] = [];
      var smJson = await this.redis.get(postId+'statusMessages');
      if( smJson && smJson.length > 0 ) {
        messages = JSON.parse(smJson);
      }
      return messages;
    });

    this._gameExpireTimeStamp = context.useState(async () => {
      return await getPostExpireTimestamp(this._context, this.myPostId);
    });

    this._title = context.useState(async () => {
      const title = await this.redis.get(postId+'title');
      if(title && title.length > 0 ) {
        return title;
      }
      return "";
    });

    this._wordsCount = context.useState(async () => {
      const wordsCount = await this.redis.get(postId+'wordsCount');
      if(wordsCount && wordsCount.length > 0 ) {
        return parseInt(wordsCount);
      }
      return 2;
    });

    this._minutesToSolve = context.useState(async () => {
      const minutes = await getMinutesToSolveFromRedis(context, this.myPostId);
      return minutes;
    });

    this._allWords = context.useState(async () => {
      const words = await getWords(context, this.myPostId);
      return words;
    });

    this._currentUserInfo = context.useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      const username = currentUser?.username??'defaultUsername';
      var userInfo:CurrentUserInfo = {username:username, isUserBanned:false, isUserModerator: false};
      //TODO: FInd simple/quick way to determine if user is banned from subreddit and set the value of isUserBanned accordingly.
      const subreddit = await this._context.reddit.getCurrentSubreddit();
      const moderators = subreddit.getModerators();
      for await (const user of moderators) {
        if( user.username == username ) {
          userInfo.isUserModerator = true;
        }
      }
      return userInfo;
    });

    this._currPage = context.useState(async () => {
      if( this.gameExpireTime < new Date() ) {
        await cancelScheduledJobs(this._context, this.myPostId);
      }
      return this.getHomePage()
    });

    this._redisKeyPrefix = this.myPostId + this.currentUserInfo.username;

    this._wordsAndLettersObj = context.useState<wordsAndLetters>(
      async() =>{
        var wl:wordsAndLetters;
        const wordsAndLettersJson = await this.redis.get(this.myPostId+'wordsAndLetters');
        if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {
          const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
          wl = wordsAndLettersObj as wordsAndLetters;
        }
        else {
          wl = await getRandomWordsAndLetters(context, this.myPostId);
          await context.redis.set(this.myPostId+'wordsAndLetters',  JSON.stringify(wl), {expiration: expireTime});
        }
        return wl;
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
      var records = await getLeaderboardRecords(context, this.myPostId);
      for(var i =0; i < records.length; i++ ) {
        if(records[i].username == this.currentUserInfo.username) {
          const usg = this._userGameStatus[0];
          usg.totalWordsSolved = records[i].totalWordsSolved;
          this.userGameStatus = usg;
        }
      }
      return records;
    });

    this._channel = useChannel<RealtimeMessage>({
      name: this.myPostId+'events',
      onMessage: (msg) => {
        if( msg.type == PayloadType.SubmittedWord ) {
          const praiseMessage = praiseMessages[Math.floor(Math.random() * praiseMessages.length) ];
          const pl = msg.payload as UserSubmittedWord;      
          this.pushStatusMessage( pl.username+" submitted the word "+ pl.word.toLocaleUpperCase()+". "+ praiseMessage, true );
        }
        else if( msg.type == PayloadType.NewWordsAndLetters ){
          const wl = msg.payload as wordsAndLetters;
          this.wordsAndLetters = wl;
          this.pushStatusMessage("Which "+ (this.wordsCount == 2? "two words" :"word")+" can you make out of "+wl.letters+" ?", false );

          let dateNow = new Date();
          const remainingTimeMillis = this._wordsAndLettersObj[0].expireTimeMillis - dateNow.getTime();
          const UGS:UserGameState = {userSelectedLetters:'', userLetters: wl.letters, remainingTimeInSeconds: remainingTimeMillis/1000, totalWordsSolved: this.userGameStatus.totalWordsSolved };
          this.userGameStatus = UGS;
        }
        else if( msg.type == PayloadType.TriggerShowAnswer ) {
          this.pushStatusMessage("Answer: "+ this.wordsAndLetters.words.join(", "), false );          
        }
        else if( msg.type == PayloadType.TriggerShowHint ) {
          if( this.wordsAndLetters.words.length == 1 ) {
            this.pushStatusMessage("Hint: The word start with letter "+ this.wordsAndLetters.words[0][0], false ); 
          }
          else {
            this.pushStatusMessage("Hint: The words start with letters "+ this.wordsAndLetters.words[0][0]+" and "+ this.wordsAndLetters.words[1][0], false ); 
          }      
        }
        else if( msg.type == PayloadType.TriggerRefreshWords ) {
          this.refreshWords();       
        }
      },
    });
    this._counterInterval = useInterval(() => {
      const ugs = this.userGameStatus;
      if( ugs.remainingTimeInSeconds > 0 ) {
        ugs.remainingTimeInSeconds = ugs.remainingTimeInSeconds - 1;
      }
      this.userGameStatus = ugs;
    }, 1000);

    this._counterInterval.start();
    this._channel.subscribe();
  }

  public async pushStatusMessage(message:string, celebrate:boolean = false){
    var messages = this.statusMessages;
    messages.push(message);
    if( messages.length > MaxMessagesCount) {
      messages.shift();//Remove last message if we already have MaxMessagesCount messages.
    }
    this.statusMessages =  messages;
    this._context.ui.webView.postMessage("feedView", {type:"newMessage", message: message, celebrate: celebrate});
  }

  public async deleteLeaderboardRec(username: string) {//TODO: Add confirmation dialog
    const leaderBoardArray = this.leaderBoardRec;
    var updatedLeaderBoardArray = this.leaderBoardRec;
    for(var i=0; i< leaderBoardArray.length; i++ ) {
      if( leaderBoardArray[i].username == username) {
        updatedLeaderBoardArray.splice(i, i+1);
      }
    }
    this.leaderBoardRec = updatedLeaderBoardArray;
    await this.redis.hDel(this.myPostId, [username]);
  }

  public getHomePage() {
    if( this.gameExpireTime > new Date() ) {
      return Pages.Game;
    }
    else {
      return Pages.GameEnd;
    }
  }
  
  public hideLeaderboardBlock() {
    this.currPage = this.getHomePage();
  }

  public showLeaderboardBlock() {
    this.currPage = Pages.LeaderBoard;
  }

  public showHelpBlock() {
    this.currPage = Pages.Help;
  }

  public hideHelpBlock() {
    this.currPage = this.getHomePage();
  }

  public resetSelectedLetters() {
    var ugs = this.userGameStatus;//Reset selected letters for this user.
    ugs.userLetters = this.userGameStatus.userLetters + this.userGameStatus.userSelectedLetters;
    ugs.userSelectedLetters = "";
    this.userGameStatus = ugs;
  }

  public shuffleLetters() {
    var ugs = this.userGameStatus;
    ugs.userLetters = this.wordsAndLetters.letters;
    ugs.userSelectedLetters = "";

    while( ugs.userLetters == this.wordsAndLetters.letters){//Only loop out when letters are not same as original letters.
      ugs.userLetters = this.wordsAndLetters.letters.split('').sort(function(){return 0.5-Math.random()}).join('');
    }
  
    this.userGameStatus = ugs;
  }

  public async refreshWords() {
    this.allWords = await getWords(this._context, this.myPostId);
  };
  
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

  public get gameExpireTime()  {
    return new Date(this._gameExpireTimeStamp[0]);
  }

  public get gameExpireTimeStr() {
    const dateStr =  this.gameExpireTime.toString();
    const dateStrFormatted = dateStr.split(":");
    dateStrFormatted.pop();
    return dateStrFormatted.join(":");
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

  public get title() {
    return this._title[0];
  }

  public get wordsCount() {
    return this._wordsCount[0];
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

  public get currentUserInfo() {
    return this._currentUserInfo[0];
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

  public set allWords(value: string[]) {
    this._allWords[0] = value;
    this._allWords[1](value);
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

  public async getAnsweredWords() {
    const answeredWordsJson = await this.redis.get(this.myPostId+'answeredWords');
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
    const wordsAndLettersJson = await this.redis.get(this.myPostId+'wordsAndLetters');
    if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {
      const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
      const wl = wordsAndLettersObj as wordsAndLetters;
      let dateNow = new Date();
      const remainingTimeMillis = this._wordsAndLettersObj[0].expireTimeMillis - dateNow.getTime();
      this.wordsAndLetters = wl;
      var ugs = this.userGameStatus;//Reset selected letters for this user.
      ugs.userLetters = wl.letters;
      ugs.userSelectedLetters = "";
      ugs.remainingTimeInSeconds = remainingTimeMillis/1000;
      this.userGameStatus = ugs;
      this.pushStatusMessage("Which "+ (this.wordsCount == 2? "two words" :"word")+" can you make out of "+wl.letters+" ?", false );
    }
  } 

  public async iswordsAndLettersStale() {
    const wordsAndLettersJson = await this.redis.get(this.myPostId+'wordsAndLetters');
    if ( wordsAndLettersJson && wordsAndLettersJson.length > 0) {//Cancel previous job if it exists.
      const wordsAndLettersObj = JSON.parse(wordsAndLettersJson);
      const wl = wordsAndLettersObj as wordsAndLetters;
      
      if( wl.letters != this.wordsAndLetters.letters ) {
        this.wordsAndLetters = wl;
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

      //Check if the submitted word was already answered by someone.
      var foundIndex = an.words.findIndex(x => x.word == this.userGameStatus.userSelectedLetters);
      if( foundIndex >= 0 ) {
        alreadyAnswered = true;
        this._context.ui.showToast({
          text: "This word was already answered by /u/"+an.words[foundIndex].username,
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
        const leaderBoardObj:leaderBoard  = { username:this.currentUserInfo.username, totalWordsSolved: this.userGameStatus.totalWordsSolved};
        var foundIndex = leaderBoardArray.findIndex(x => x.username == this.currentUserInfo.username);

        if( foundIndex >= 0 ) {//Update in place
          leaderBoardArray[foundIndex] = leaderBoardObj;
        }
        else {
          leaderBoardArray.push(leaderBoardObj);
        }

        leaderBoardArray.sort((a, b) =>  b.totalWordsSolved - a.totalWordsSolved);
        this.leaderBoardRec = leaderBoardArray;
        await this.redis.hSet(this.myPostId, { [this.currentUserInfo.username]: JSON.stringify(leaderBoardObj) });
        await this.redis.expire(this.myPostId, redisExpireTimeSeconds);
        this.userGameStatus = ugs;
      }

      if( ! isStale && !alreadyAnswered  ) {
        const pl:UserSubmittedWord = { word:this.userGameStatus.userSelectedLetters, username: this.currentUserInfo.username};
        const rm: RealtimeMessage = { payload: pl, type: PayloadType.SubmittedWord};
        await this._channel.send(rm);
        this.resetSelectedLetters();
        const praiseMessage = praiseMessages[Math.floor(Math.random() * praiseMessages.length) ];      
        pushStatusMessageGlobal(pl.username+" submitted the word "+ pl.word.toLocaleUpperCase()+". "+ praiseMessage, this._context, this.myPostId);

        an.words.push(pl);
        if( an.words.length == this.wordsAndLetters.words.length ) {//All words are already answered. Time to change the words and letters.
          const wl:wordsAndLetters = await getRandomWordsAndLetters(this._context, this.myPostId);
          await this.redis.set(this.myPostId+'wordsAndLetters',  JSON.stringify(wl), {expiration: expireTime});
          const rm: RealtimeMessage = { payload: wl, type: PayloadType.NewWordsAndLetters};
          await this._channel.send(rm);
          await this.redis.del(this.myPostId+'answeredWords');

          pushStatusMessageGlobal("Which "+ (this.wordsCount == 2? "two words" :"word")+" can you make out of "+wl.letters+" ?",  this._context, this.myPostId );

          createChangeLettersThread(this._context, this.myPostId);//Recreate the change-letters thread freshly so that new question does not get removed before answering.
        }
        else {//add to answered words list in redis.
          await this.redis.set(this.myPostId+'answeredWords',  JSON.stringify(an), {expiration: expireTime});
        }
      }
      else if( isStale && !alreadyAnswered){ //Refresh the wordsAndLetters object with the present one.
        await this.refreshUserLetters();
      }
    }
    else {
      this._context.ui.showToast({
        text: "Sorry, that's not correct!",
        appearance: 'neutral',
      });      
    }
  }
}

const wordsInputForm = Devvit.createForm( (data) => {
  return {
    title : `Create ${gameTitle} post`,
    acceptLabel: "Submit",
    fields: [
      {
        name: 'words',
        label: 'Enter comma separated list of words',
        type: 'paragraph',
        helpText: `Comma separated list of words for the ${gameTitle}`,
        required: true
      },
      {
        name: 'title',
        label: 'Title for the game post',
        type: 'string',
        helpText: 'Title for the post (example: Which South Park character names can you make from the given letters?)',
        required: true
      },
      {   
        name: 'wordsCount',
        type: 'select',
        label: 'Number of words to scramble together',
        helpText: 'Number of words to scramble/jumble together. This can be either 1 (easy) or 2 (hard).',
        required: true,
        options: [
          { label: '2', value: '2' },
          { label: '1', value: '1' }
        ],
        defaultValue:['2'],
      },
      {
        name: 'minutesToSolve',
        label: 'Minutes to solve each set of letters',
        type: 'number',
        helpText: 'Max number of minutes allowed to solve each set of scrambled/jumbled letters.',
        defaultValue: 3,
        required: true
      },
      {
        name: 'showHint',
        label: 'Show hint after half-time',
        type: 'boolean',
        helpText: 'If enabled, a hint of starting letter(s) would be shown after half time.',
        defaultValue: true,
        required: true
      },
      {
        name: 'totalGameDurationHours',
        label: 'Total game duration in hours',
        type: 'number',
        helpText: 'Total game duration in hours, after which the leaderboard entries would be frozen.',
        defaultValue: 24,
        required: true
      },
      {
        type: 'select',
        name: 'flair',
        label: 'Flair',
        options: data.flairOptions,
        helpText: "Select a flair for your post.",
        required: data.flairOptions.length > 0 ? true: false,
      }, ],
    };
  },
  async (event, context) => {// onSubmit handler
    const ui  = context.ui;
    const reddit = context.reddit;
    const subreddit = await reddit.getCurrentSubreddit();
    const submittedWords = event.values.words.toUpperCase();
    const title = event.values.title;
    const minutesToSolve = event.values.minutesToSolve;
    const totalGameDurationHours = event.values.totalGameDurationHours;
    const wordsCount = event.values.wordsCount[0];
    const flairId = event.values.flair ? event.values.flair[0] : null;
    const showHint =  event.values.showHint;

    const post = await reddit.submitPost({
      title: title,
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
  var postId = post.id;

  const spoilerComment = await context.reddit.submitComment({
    id: `${postId}`,
    text: "Words in the set: >!"+submittedWords+"!<"
  });

  await redis.set(postId+'words', submittedWords, {expiration: expireTime} );
  await redis.set(postId+'title', title, {expiration: expireTime});
  await redis.set(postId+'wordsCount', wordsCount, {expiration: expireTime});
  await redis.set(postId+'minutesToSolve', Math.trunc(minutesToSolve).toString(), {expiration: expireTime});
  await redis.set(postId+'totalGameDurationHours', Math.trunc(totalGameDurationHours).toString(), {expiration: expireTime});
  await redis.set(postId+'spoilerCommentId', spoilerComment.id, {expiration: expireTime});
  await redis.set(postId+'showHint', showHint.toString(), {expiration: expireTime});

  ui.showToast({
    text: `Successfully created a ${gameTitle} post!`,
    appearance: 'success',
  });
  context.ui.navigateTo(post.url);
});

Devvit.addMenuItem({
  label: `Create ${gameTitle} post`,
  location: 'subreddit',
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

Devvit.addCustomPostType({
  name: 'Unscramble Post',
  height: 'tall',
  render: (_context) => {
    const myPostId = _context.postId ?? 'defaultPostId';

    const game = new UnscrambleGame(_context, myPostId);
    const {currentPage, currentItems, toNextPage, toPrevPage} = usePagination(_context, game.leaderBoardRec, leaderBoardPageSize);
    let cp: JSX.Element[];
    
    const updateWordsForm = useForm(
      {
        title : `Update ${gameTitle} words`,
        description:"Please provide comma separated list of words for the game",
        acceptLabel: "Submit",
        fields: [
          {
            type: 'paragraph',
            name: 'words',
            label: 'Enter your words',
            defaultValue: game.allWords.join(", "),
          },
        ],
      },
      async (values) => {
        await _context.redis.set(game.myPostId+'words', values.words);
        var wordsArray = values.words.split(",").map(function (value) {
          return value.trim();
       });
        game.allWords = wordsArray;
        const rms: RealtimeMessage = { payload: {}, type: PayloadType.TriggerRefreshWords};
        await _context.realtime.send(myPostId+'events', rms);
      }
    );

    const openUserPage = async (username: string) => {
      _context.ui.navigateTo(`https://www.reddit.com/user/${username}/`);
    };

    const letterCells = game.userGameStatus.userLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor={letterBorderColour} cornerRadius="small" onPress={() => game.addLetterToSelected(index)}>
          <text size="large" color="black" weight="bold">{letter}</text>
        </vstack>
        <spacer size="xsmall" />
      </>
    ));

    const selectedLetterCells = game.userGameStatus.userSelectedLetters.split("").map((letter, index) => (<>
        <vstack backgroundColor="#f5b642" width="26px" height="26px" alignment="center middle" borderColor={letterBorderColour} cornerRadius="small" onPress={() => game.removeLetter(index)}>
          <text size="large" color="black" weight="bold">{letter}</text>
        </vstack>
      <spacer size="xsmall" />
      </>
    ));

    const SelectedLettersBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack>
        <hstack alignment="center middle" width="100%"  height="30px" min-height="30px">
          <text size="medium" weight='bold' color={textColour}>Selected Letters:</text>
          <spacer grow />
          <text size="medium" weight='bold' color={textColour} width="90px">🕒 left: {Math.trunc(game.userGameStatus.remainingTimeInSeconds)}</text>
        </hstack>

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
            <button size="small" icon='random' onPress={() => game.shuffleLetters()}>Shuffle</button> <spacer size="small" />
            <button size="small" icon='undo' onPress={() => game.resetSelectedLetters()}>Reset</button>
          </hstack>
        </vstack>
      </vstack>
    );

    const GameBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack alignment="center top">
        <text style="body" size="medium" alignment="center middle" color="#84d995" width="330px" height="18px" wrap>
          Game ends at:  { game.gameExpireTimeStr}
        </text>
        <spacer size="xsmall" />
        <text style="heading" size="large" weight='bold' alignment="center middle" color={textColour} width="330px" height="18px" wrap>
          Select letters below to make a word:
        </text>
        <spacer size="xsmall" />

        <vstack alignment="top start" width="312px" border="thin" borderColor={borderColour} padding='xsmall' minHeight="75px">
          {splitArray(letterCells, 10).map((row) => ( <>
            <hstack>{row}</hstack>
            <spacer size="xsmall" />
          </>
          ))}
        </vstack>
        <SelectedLettersBlock game={game} />
        <spacer size="small" />
        <webview id="feedView" width="310px" height="200px" url="feed.html"  onMessage={(msg) => {
          const wr = msg as webviewDataRequest;
          if( wr.type == "requestInitialFeedData") {//Load initial feed data.
            _context.ui.webView.postMessage("feedView", {type: "initialFeedData", messages: game.statusMessages});
          }
        }}/>
      </vstack>
    );
    
    const LeaderBoardBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack width="97%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
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
          { game.currentUserInfo.isUserModerator ? <text size="small" color="black" onPress={() => game.deleteLeaderboardRec(row.username)} width="5%">X</text>: ""}
        </hstack>
      );
    };

    const HelpBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="97%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small" width="100%">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="100%" color='black'>
                Help 
            </text>
          </hstack>
          <vstack height="82%" width="100%" padding="medium">
            <hstack alignment='start middle'>
              <icon name="help" size="xsmall" color='black'></icon>
              <text style="heading" size="medium" color='black'>
                &nbsp; How to play {gameTitle}
              </text>
            </hstack>
            <text style="body" wrap size="medium" color='black'>
              Unscramble words (as described in post title) from the given set of letters.  Each set of letters contains a minimum of {game.wordsCount} word(s) scrambled. Tap on the letters to select, and click on submit after the word is completed.
              New set of scrambled letters are presented after all words are solved, or after {game.minutesToSolve} minute(s).
            </text>
            <spacer size="small" />

            <hstack alignment='start middle'>
              <icon name="comment" size="xsmall" color='black'></icon>
              <text style="heading" size="medium" color='black'>
                &nbsp; Finding all the words in set
              </text>
            </hstack>
            <text style="body" wrap size="medium" color='black'>
              You can find all the words in set posted in comments section(with spoiler treatment). Click on it to reveal all the possible words.
            </text> 
            <spacer size="small" />

          </vstack>
          <hstack alignment="bottom center" width="100%" height="8%">
            <button size="small" icon='close' onPress={() => game.hideHelpBlock()}>Close</button>
          </hstack>
        </vstack>
      </vstack>
    );

    const GameEndBlock = ({ game }: { game: UnscrambleGame }) => (
      <vstack width="344px" height="100%" backgroundColor="transparent" alignment="center middle">
        <vstack  width="97%" height="100%" alignment="top start" backgroundColor='white' borderColor='black' border="thick" cornerRadius="small">
          <hstack padding="small" width="100%">
            <text style="heading" size="large" weight='bold' alignment="middle center" width="100%" color='black'>
                This Unscramble Game has ended. 
            </text>
          </hstack>
          <vstack height="82%" width="100%" padding="medium">
            <spacer size="small" />
            <hstack alignment='start middle'>
              <text style="heading" size="medium" color='black'>
                Below were the words in the set
              </text>
            </hstack>
            <text style="body" wrap size="medium" color='black'>
              {game.allWords.join(", ")}
            </text>
            <spacer size="small" />
            <hstack alignment='start middle'>
              <icon name="list-numbered" size="xsmall" color='black'></icon>
              <text style="heading" size="medium" color='black'>
                &nbsp;View leaderboard.
              </text>
            </hstack>
            <text style="body" wrap size="medium" color='black'>
              Check out the leaderboard for scores.
            </text> 
            <spacer size="small" />
          </vstack>
        </vstack>
      </vstack>
    );

    cp = [ <GameBlock game={game} />,
      <LeaderBoardBlock game={game} />,
      <HelpBlock game={game} />,
      <GameEndBlock game={game} />,
     ];

    return (
    <blocks height="tall">
      <vstack alignment="center top" width="100%" height="100%">
        <vstack height="100%" width="344px" alignment="center top" padding="xsmall" backgroundColor='#395654' cornerRadius="small">
          <vstack height="90%" min-height="90%">
            {cp[game.currPage]}
          </vstack>
          
          <hstack alignment="center middle" width="100%" height="10%">
            <button size="small" icon='list-numbered' onPress={() => game.showLeaderboardBlock()}>Leaderboard</button> 
            <spacer size="small" />
            <button size="small" icon='help'  onPress={() => game.showHelpBlock()}>Help</button>
            <spacer size="small" />         
            { game.currentUserInfo.isUserModerator? <button size="small" icon='settings'  onPress={() => _context.ui.showForm(updateWordsForm)}></button>:"" }
          </hstack>
          <spacer size="xsmall" />
        </vstack>
      </vstack>
    </blocks>
    );
  },
});

export default Devvit;
