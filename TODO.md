

    Data Model:
        Update localStorage to store an array of conversation objects, where each object has an ID, title, and its own array of messages.

    UI Changes:
        Sidebar: Add a sidebar to list all conversations. It needs a "New Chat" button.
        Main View: The chat area should only display messages from the currently active conversation.
        Titles: Allow users to edit conversation titles.

    Logic:
        When a user sends a message, it should be saved to the currently active conversation.
        All changes must be saved to localStorage.
        Implement a one-time migration to convert any existing single-log history into the new format.
