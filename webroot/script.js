const listContainer = document.getElementById("list-container");
const jsConfetti = new JSConfetti();

window.onmessage = (ev) => {
    console.log("Got message now...");
    var message = ev.data.data.message.message;
    var celebrate = ev.data.data.message.celebrate;
    if( message.length > 0 ) {
        const newItem = document.createElement("div");
        newItem.classList.add("item");
        newItem.textContent = message;
    
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

    }

    if( celebrate == true ) {
        jsConfetti.addConfetti();
        /*
        jsConfetti.addConfetti().then(() => jsConfetti.addConfetti({
            emojis: ['🌈', '⚡️', '💥', '✨', '💫', '🌸'],
        })); */
    }
  
  }