# Unscramble Game Overview
This app lets you create Unscramble game with words tailored to your own community! You can input a set of words related to your community, along with a title and time limit to solve the word(s) (For example: A subreddit of a TV show may choose to use character names of the show, a subreddit for a programming language may choose to use keywords of programming for the game etc.). The app would then show scrambled letters from your chosen set of words. You can choose to show just letters of one word scrambled (easy), or to show two words scrambled together(hard). Users can solve the word by tapping/clicking on the letters, and click on submit after the word is completed. New set of scrambled letters are presented after solving word(s), or after the timeout. Users can unselect the letter by clicking on the letters in `Selected Letters` section. All community members are presented with the same set of letters in real-time, and anybody in the subreddit can solve them.

![Screenshot](https://i.imgur.com/zt4WEia.png)

### How to install and use the app:

1) Moderators of the subreddit can install the app by going to [https://developers.reddit.com/apps/unscramble-game](https://developers.reddit.com/apps/unscramble-game)
2) After installing the app to your subreddit, go to your subreddit's [three-dot-menu (...)](https://developers.reddit.com/docs/capabilities/menu-actions), and select "Create Unscramble-Game post".
3) You will be presented with a form to provide input of words(comma separated list), title for the words, number of words to scramble/jumble together, and maximum minutes to solve word(s). It would be ideal to provide words without spaces in them [for example: If the words represent a set of TV character names, then it would be ideal to just enter the first part of the name ('Eric' instead of 'Eric Cartman') in the list].
4) After you submit the form, your game post would be created in the subreddit and it would be open for all members to play. If you are on web browser, you will be re-directed to the post as well.

## Features:
* Live Game Feed
The app view contains a live game feed, which shows message on which word was sloved along with their username.

* Leaderbaord
Leaderboard contains the list of usernames, and the number of words they have solved.

## Changelog
* v0.0.1
  * Initial Release with features of unscrambling two words, live game feed and leaderboard features.
* v0.0.8
  * Enablement to have multiple posts of this game in same subreddit. Add option to either have one word, or two word scrambled at a time for solving.
* 0.0.14.8
  * Add option to delete Leaderboard entries for moderators.

## Links
### Demo
You can try out this game by going here:
[https://www.reddit.com/r/UnscrambleGame/](https://www.reddit.com/r/UnscrambleGame/)
