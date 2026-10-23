/*
 * CLUBS - player names.
 * Every game the four players are named at random after Atlantic hurricanes: every name ever retired by the
 * World Meteorological Organization plus all six current rotating lists. Pure logic; works in the browser
 * and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClubsNames = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HURRICANE_NAMES = [
    'Agnes', 'Alberto', 'Alex', 'Alicia', 'Allen', 'Allison', 'Ana', 'Andrea', 'Andrew', 'Anita',
    'Arlene', 'Arthur', 'Audrey', 'Barry', 'Bertha', 'Beryl', 'Betsy', 'Beulah', 'Bill', 'Bob',
    'Bonnie', 'Bret', 'Brianna', 'Camille', 'Carla', 'Carmen', 'Carol', 'Celia', 'Cesar', 'Chantal',
    'Charley', 'Chris', 'Cindy', 'Claudette', 'Cleo', 'Colin', 'Connie', 'Cristobal', 'Danielle',
    'Danny', 'David', 'Dean', 'Debby', 'Dennis', 'Dexter', 'Diana', 'Diane', 'Dolly', 'Don', 'Donna',
    'Dora', 'Dorian', 'Earl', 'Edna', 'Edouard', 'Elena', 'Eloise', 'Elsa', 'Emily', 'Erika', 'Erin',
    'Ernesto', 'Fabian', 'Farrah', 'Fay', 'Felix', 'Fernand', 'Fifi', 'Fiona', 'Flora', 'Florence',
    'Floyd', 'Fran', 'Frances', 'Francine', 'Franklin', 'Fred', 'Frederic', 'Gabrielle', 'Gaston',
    'Georges', 'Gert', 'Gilbert', 'Gloria', 'Gonzalo', 'Gordon', 'Grace', 'Greta', 'Gustav', 'Hanna',
    'Harold', 'Harvey', 'Hattie', 'Hazel', 'Helene', 'Henri', 'Hermine', 'Hilda', 'Holly', 'Hortense',
    'Hugo', 'Humberto', 'Ian', 'Ida', 'Idalia', 'Idris', 'Igor', 'Ike', 'Imani', 'Imelda', 'Inez',
    'Ingrid', 'Ione', 'Irene', 'Iris', 'Irma', 'Isaac', 'Isabel', 'Isaias', 'Isidore', 'Ivan', 'Janet',
    'Jeanne', 'Jerry', 'Joan', 'Joaquin', 'Jose', 'Josephine', 'Joyce', 'Juan', 'Julia', 'Julian',
    'Karen', 'Karl', 'Kate', 'Katia', 'Katrina', 'Keith', 'Kirk', 'Klaus', 'Kyle', 'Larry', 'Laura',
    'Leah', 'Lee', 'Lenny', 'Leslie', 'Lili', 'Lisa', 'Lorenzo', 'Luis', 'Marco', 'Margot', 'Maria',
    'Marilyn', 'Martin', 'Matthew', 'Melissa', 'Michael', 'Michelle', 'Miguel', 'Milton', 'Mindy',
    'Mitch', 'Molly', 'Nadine', 'Nana', 'Nate', 'Nestor', 'Nicholas', 'Nicole', 'Nigel', 'Noel',
    'Odette', 'Olga', 'Omar', 'Opal', 'Ophelia', 'Oscar', 'Otto', 'Owen', 'Pablo', 'Paloma', 'Patty',
    'Paula', 'Paulette', 'Peter', 'Philippe', 'Rafael', 'Rebekah', 'Rene', 'Richard', 'Rina', 'Rita',
    'Rose', 'Roxanne', 'Sally', 'Sam', 'Sandy', 'Sara', 'Sean', 'Sebastien', 'Shary', 'Stan', 'Tammy',
    'Tanya', 'Teddy', 'Teresa', 'Tobias', 'Tomas', 'Tony', 'Valerie', 'Van', 'Vicky', 'Victor',
    'Vince', 'Virginie', 'Walter', 'Wanda', 'Wendy', 'Whitney', 'Wilfred', 'William', 'Wilma',
  ];

  // The human player's scorecard reads "<name> (You)" and has to fit the same card width as the old
  // "Dealer (You)", so the human gets a short name.
  const MAX_HUMAN_LENGTH = 6;

  // Four different names, one per seat. `rng` makes picks reproducible (the ?seed= switch).
  function pickNames(seats, rng) {
    const random = rng || Math.random;
    const pool = HURRICANE_NAMES.slice();
    function take(list) {
      const name = list[Math.floor(random() * list.length)];
      pool.splice(pool.indexOf(name), 1);
      return name;
    }
    const picked = {};
    // seats[0] is the human; choose it first from the short names.
    picked[seats[0]] = take(pool.filter((n) => n.length <= MAX_HUMAN_LENGTH));
    seats.slice(1).forEach((seat) => (picked[seat] = take(pool)));
    return picked;
  }

  return { HURRICANE_NAMES, MAX_HUMAN_LENGTH, pickNames };
});
