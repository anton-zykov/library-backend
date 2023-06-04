const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const Author = require('./models/Author');
const Book = require('./models/Book');
const { GraphQLError } = require('graphql');
const User = require('./models/User');
const jwt = require('jsonwebtoken');

require('dotenv').config();
const { MONGODB_URI } = process.env;

console.log('connecting to', MONGODB_URI);

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('connected to MongoDB');
  })
  .catch((error) => {
    console.log('error connection to MongoDB:', error.message);
  });

const typeDefs = `
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Author {
    name: String!
    born: Int
    bookCount: Int!
    id: ID!
  }

  type Query {
    me: User
    bookCount: Int!
    authorCount: Int!
    allBooks(
      author: String
      genre: String
    ): [Book!]!
    allAuthors: [Author!]!
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String!]!
    ): Book!
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
  }
`;

const resolvers = {
  Query: {
    me: (_root, _args, context) => context.currentUser,
    bookCount: async () => Book.collection.countDocuments(),
    authorCount: async () => Author.collection.countDocuments(),
    allBooks: async (_root, args) => {
      if (args.author && args.genre) {
        const author = await Author.findOne({ name: args.author });
        return Book.find({ author, genres: { $all: [args.genre] } }).populate('author');
      }

      if (args.author) {
        const author = await Author.findOne({ name: args.author });
        return Book.find({ author }).populate('author');
      }

      if (args.genre) {
        return Book.find({ genres: { $all: [args.genre] } }).populate('author');
      }

      return Book.find({}).populate('author');
    },
    allAuthors: async () => {
      const authors = await Author.find({});

      return authors.map(async (author) => {
        const books = await Book.find({ author });
        return { id: author.id, name: author.name, born: author.born, bookCount: books.length };
      });
    }
  },
  Mutation: {
    addBook: async (_root, args, context) => {
      if (!context.currentUser) {
        throw new GraphQLError(
          'Invalid token.',
          {
            extensions: {
              code: 'BAD_USER_INPUT'
            }
          }
        );
      }

      // Add author if this is his/her first book.
      let author = await Author.findOne({ name: args.author });
      if (!author) {
        if (args.author.length < 4) {
          throw new GraphQLError(
            'Author\'s name should be at least 4 characters long.',
            {
              extensions: {
                code: 'BAD_USER_INPUT',
                invalidArgs: args.name
              }
            }
          );
        }
        author = new Author({ name: args.author });
        await author.save();
      }

      if (args.title.length < 5) {
        throw new GraphQLError(
          'Book\'s title should be at least 5 characters long.',
          {
            extensions: {
              code: 'BAD_USER_INPUT',
              invalidArgs: args.title
            }
          }
        );
      }

      const book = new Book({ ...args, author });
      await book.save();
      return book.populate('author');
    },
    editAuthor: async (_root, args, context) => {
      if (!context.currentUser) {
        throw new GraphQLError(
          'Invalid token.',
          {
            extensions: {
              code: 'BAD_USER_INPUT'
            }
          }
        );
      }

      const author = await Author.findOne({ name: args.name });

      if (!author) {
        throw new GraphQLError(
          'The user does not exist.',
          {
            extensions: {
              code: 'BAD_USER_INPUT',
              invalidArgs: args.name
            }
          }
        );
      }

      author.born = args.setBornTo;
      return author.save();
    },
    createUser: async (_root, args) => {
      const user = new User({
        username: args.username,
        favoriteGenre: args.favoriteGenre
      });

      return user.save()
        .catch((error) => {
          throw new GraphQLError(
            'User creation failed.',
            {
              extensions: {
                code: 'BAD_USER_INPUT',
                invalidArgs: args.name,
                error
              }
            }
          );
        });
    },
    login: async (_root, args) => {
      const user = await User.findOne({ username: args.username });

      if (!user || args.password !== 'secret') {
        throw new GraphQLError(
          'Wrong credentials.',
          {
            extensions: {
              code: 'BAD_USER_INPUT'
            }
          }
        );
      }

      const userForToken = {
        username: user.username,
        id: user._id
      };

      return {
        value: jwt.sign(userForToken, process.env.JWT_SECRET)
      };
    }
  }
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null;
    if (auth && auth.startsWith('Bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7),
        process.env.JWT_SECRET
      );
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }

    return null;
  }
}).then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
