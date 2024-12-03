const listContainer = document.getElementById("list-container");
const addRowButton = document.getElementById("add-row");

const jsConfetti = new JSConfetti();

addRowButton.addEventListener("click", () => {
    const newItem = document.createElement("div");
    newItem.classList.add("item");
    newItem.textContent = `Item ${listContainer.children.length + 1}`;

    // Add the new item at the bottom
    listContainer.appendChild(newItem);

    // Animate the appearance of the new item
    newItem.style.opacity = "0";
    newItem.style.transform = "translateY(20px)";
    setTimeout(() => {
        newItem.style.opacity = "1";
        newItem.style.transform = "translateY(0)";
    }, 50);

    // Scroll to the bottom to ensure the new item is visible
    setTimeout(() => {
        listContainer.scrollTop = listContainer.scrollHeight;
    }, 100);


    jsConfetti.addConfetti({
        emojis: ['🌈', '⚡️', '💥', '✨', '💫', '🌸'],
    }).then(() => jsConfetti.addConfetti())
});



window.onmessage = (ev) => {
    console.log("Got something now...");
    lettersData = ev.data.data.message.letters;
  
    if( lettersData.length > 0 ) {
        jsConfetti.addConfetti({
            emojis: ['🌈', '⚡️', '💥', '✨', '💫', '🌸'],
        }).then(() => jsConfetti.addConfetti())
    }
  
  }