# Unscramble Game Overview
This is a game of unscrambling words. The app shows letters of two words jumbled together. Users can tap/click on each of the letters to select, and click on submit after the word is completed. New set of scrambled letters are presented after both the words are solved, or after the timeout. Users can unselect the letter by clicking on the letters in Selected Letters section. All community members are presented with the same set of letters in real-time, and anybody in the subreddit can solve them. The set of words used in the game is customizable to words related to specific subreddits/communities on reddit(for example: A subreddit of a TV show may choose to use character names of the show, and a subreddit for a programming language may choose to use keywords of programming for the game etc.). 

### How to install and use the app:

1) Moderators of the subreddit can install the app by going to [https://developers.reddit.com/apps/unscramble-game](https://developers.reddit.com/apps/unscramble-game)
2) After installing the app to your subreddit, go to your subreddit's [three-dot-menu (...)](https://developers.reddit.com/docs/capabilities/menu-actions), and select "Create Unscramble Game post".
3) You will be presented with a form to provide input of words(comma separated list), name for what those words represent (for example: Character Names, keywords etc.), and maximum minutes to solve each set of words. It would be ideal to provide single words (without spaces in them) - so in case the words represent a set of TV character names(like `Eric Cartman`), then it would be ideal to just enter the first part of the name ('Eric') in the list.
4) After you submit the form, your post would be created in the subreddit and game would be open for members to play. If you are on web browser, you will be re-directed to the post as well.

## Features:
* Live Game Feed
The app view contains a live game feed, which shows message on which word was sloved along with the username.

* Leaderbaord
Leaderboard contains the list of usernames, and the number of words they have solved.

## Changelog
* v0.0.1
  * Initial Release with features of unscrambling two words, live game feed and leaderboard features.
* v0.0.8
  * Enablement to have multiple posts of this game in same subreddit. Add option to either have one word, or two word scrambled at a time for solving.

## Links
### Demo
You can try out this game by going here:
https://www.reddit.com/r/UnscrambleGame/
