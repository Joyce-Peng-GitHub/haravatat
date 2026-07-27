# Harvaratat

Haravatat is a multi-user blog system supporting both Markdown and **Typst**.

Internationalization should be supported.

## Users and Accounts

*Users* can *sign up* and *sign in* by their GitHub accounts. They can also *delete* their accounts --- in that case, we need to **softly delete** their account, articles and comments. The soft deletion of articles and comments will be described later.

### Administrators

Some users are administrators. Their responsibilities and rights are yet to be decided.

### Super-Admin

The maintainer of the blog system is the unique super admin. He can set normal users to administrators or vice versa. He can edit anything.

## Articles and Comments

Users can publish articles and leave comments on articles and other comments, written either in Markdown or Typst. They can select the markup language for each article when both publishing a new article or comment or updating an existing one. They can *mention* other users, articles or comments by their links.

### Images

Users can upload images to attach them to an article or a comment.

### Themes

Users can customize themes for their Markdown articles through CSS and HTML scripts.

### Compilation

Once an article or a comment is posted or updated, we need to (re-)compile it into HTML for fast loading. Particularly, if compiling a Typst file to an HTML is not possible yet, we can compile it to a PDF and embed it to the webpage. In that case, if possible, it may be compiled to a flow document instead of a paged one.

Note that images will be embedded when a Typst file is compiled. Reference to image files should be restricted to avoid illegal access to other files.

### Tags

Users can assign *tag*s to their articles. An article can be assigned zero or multiple tags.

The limits of tags a user can create or an article can be assigned should both be set by environment variables.

### Deletion

Users can *update* or *delete* (**softly**) their articles or comments. When they are deleted, their titles (for articles only) and  contents will be hidden (displayed as deleted) but, comments on them will remain.

### Visibility

Users can choose an visibility level for each article:

1. **Public:** Everyone, including guests who have not logged in to the blog system, can browse the article.
2. **Protected:** The user can choose from
   1. Only users of the website can access.
   2. Only the author's subscribers and subscribing users can access.
3. **Private:** The user can choose from
   1. Only users subscribed by the author can access.
   2. Only users entering the correct password can access.
   3. Only the author's selected users can access.
   4. Only the author can access.

Comments are always public.

### Interactions

Users can *view*, *like*, *favorite* and comment on articles. They can also *like* and comment on comments.

### Metadata

Metadata of both articles and comments:

- Time of last update.
- Like count.
- Comment count (counted recursively).

Metadata of articles only:

- Favorite count.
- View count.

## Profiles

The profile page of a user shows

- A link to his GitHub profile.
- Number of subscribers and users he subscribe to.
- An "Articles/Comments" switch.
  - The user's tags are also shown, and articles can be filtered by tags. List out articles that the visitor have access to, displayed with metadata. Specifically, articles with a password are displayed, but require the password if browsed.
  - Comments with metadata.

## Subscription

Users can *subscribe* other users. They can decide whether to receive notifications for their subscribed author's new articles or comments.

## Notification

There is an in-site *notification* system. Users are notified when

- their subscribed users publish new articles accessible to them.
- their subscribed users posted new comments.
- they get a new subscriber.
- they lose a subscriber.
- they get a new "like" from somebody.
- they get a new "favorite".

Each type of the notifications, as listed above, can be turned off independently.

Users can *read* and *unread* notifications.

When displayed, notifications are sorted by `(is_read, time)` descended.

## Search

All articles, including both titles and bodies, and all comments, needed to be indexed. Users may use different languages.

The searching result can be sorted by relevance (only descending) or time of last update (either ascending or descending).

### Search Generally

There is a searching box on the top of the webpage. Users can search for articles accessible to them or for users (maybe by GitHub accounts). The type of search can be chosen.

### Search in a User

In a user's profile page, one can search for contents filtered by the tags he selected. This search box, therefore, should be placed under the  tags.

Comment of a user can also be searched.
