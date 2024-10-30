// Learn more at developers.reddit.com/docs
import { Devvit, useState,ContextAPIClients,RedisClient,UIClient,UseStateResult} from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
});

type namesAndLetters = {
  letters: string;
  names: string[];
};

type UserGameState = {
  userSelectedLetters: string;
  userLetters: string;
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
  private _namesAndLettersObj:namesAndLetters;

  private _userGameStatus: UseStateResult<UserGameState>;


  constructor( context: ContextAPIClients, postId: string) {
    this._context = context;
    this._ui = context.ui;
    this.redis = context.redis;
    this._ScreenIsWide = this.isScreenWide();

    this._myPostId = context.useState(async () => {
      return postId;
    });

    this._currentUsername = context.useState(async () => {
      const currentUser = await context.reddit.getCurrentUser();
      return currentUser?.username??'defaultUsername';
    });

    this._redisKeyPrefix = this.myPostId + this.currentUsername;
    this._namesAndLettersObj = this.getRandomNamesAndLetters();

    this._userGameStatus = context.useState<UserGameState>(
      async() =>{
        const UGS:UserGameState = {userSelectedLetters:'', userLetters: this._namesAndLettersObj.letters};
        return UGS;
      }
    );
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
    //var userSelectedLetters  = ugs.userSelectedLetters;
    //var userLetters = ugs.userLetters;

    ugs.userSelectedLetters = ugs.userSelectedLetters + ugs.userLetters[index];
    var letters = Array.from(ugs.userLetters);
    letters.splice(index, 1);
    ugs.userLetters = letters.join('');
    this.userGameStatus = ugs;

    console.log("User letters:"+ this.userGameStatus.userLetters);
    console.log("User selected letters:"+ this.userGameStatus.userSelectedLetters);

  }

  public get myPostId() {
    return this._myPostId[0];
  }

  public get letters() {
    return this._namesAndLettersObj.letters;
  }

  public get names() {
    return this._namesAndLettersObj.names;
  }

  get redisKeyPrefix() {
    return this._redisKeyPrefix;
  }

  public get currentUsername() {
    return this._currentUsername[0];
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
    const [counter, setCounter] = useState(0);

    const myPostId = _context.postId ?? 'defaultPostId';
    const game = new UnscrambleGame(_context, myPostId);

    console.log("here are the random names:");
    console.log(game.names);

    console.log("here is the characters set:");
    console.log(game.letters);

    return (
      <vstack height="100%" width="100%" gap="medium" alignment="center middle">
        <image
          url="logo.png"
          description="logo"
          imageHeight={256}
          imageWidth={256}
          height="48px"
          width="48px"
        />
        <text size="large">{`Click counter: ${counter}`}</text>
        <button appearance="primary" onPress={() => setCounter((counter) => counter + 1)}>
          Click me!
        </button>
        <hstack>
          {
            game.userGameStatus.userLetters.split("").map((row, index) => (
              <>
              <button appearance="destructive"  width="28px" height="28px" onPress={() => game.addCharacterToSelected(index)} >{row.toUpperCase()}</button> <spacer size="small"/>
              </>
          ))}
        </hstack>
      </vstack>
    );
  },
});

export default Devvit;



