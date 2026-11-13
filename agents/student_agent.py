# Student agent: Add your own agent here
from agents.agent import Agent
from store import register_agent
import numpy as np
import time
import copy
import heapq


@register_agent("student_agent")
class StudentAgent(Agent):
    """
        A dummy class for your implementation. Feel free to use this class to
        add any helper functionalities needed for your agent.
        """

    def __init__(self):
        super(StudentAgent, self).__init__()
        self.name = "StudentAgent"
        self.dir_map = {
            "u": 0,
            "r": 1,
            "d": 2,
            "l": 3,
        }
        self.num_to_dir = {
            0: "u",
            1: "r",
            2: "d",
            3: "l"
        }
        self.opposites = {0: 2, 1: 3, 2: 0, 3: 1}
        self.moves = ((-1, 0), (0, 1), (1, 0), (0, -1))

    def get_possible_moves(self, my_pos, max_step, chess_board, adv_pos):
        '''
        A funtion that looks at current position and returns list of possible moves via BFS
        Input: my_position, chess_board, max steps(int)
        Output: list of coordinates+dir ((int, int), int)
        '''

        #Initiate list of visited nodes
        seen = set()
        bfs = [my_pos]
        x, y = my_pos
        seen.add((x, y))

        #Depth counter
        dist = 0
        counter = 1
        next_count = 0

        #List of allowed moves
        allowed_moves = []

        while bfs:
            r, c = bfs.pop(0)

            #If visited all nodes at this depth, depth + 1
            if counter == 0:
                dist += 1
                counter = next_count
                next_count = 0

            #Append all possible sides to put wall for each cell
            for i in range(0, 4):
                if not chess_board[r, c, i]:
                    allowed_moves.append(((r, c), i))

            #Search currently visiting cell's surrounding cells
            for d in range(0, 4):
                if dist + 1 > max_step:
                    break
                tmp_pos = (r + self.moves[d][0], c + self.moves[d][1])
                a, b = tmp_pos

                if not chess_board[r, c, d] and not adv_pos == tmp_pos and tmp_pos not in seen:
                    bfs.append(tmp_pos)
                    next_count += 1
                    seen.add(tmp_pos)

            counter -= 1

        return allowed_moves

    def distance_to_all_cells(self, my_pos, chess_board, adv_pos, me):
        '''
           A funtion that looks at current position and returns a 2D array of board_size*board_size representing
           the distance from the current position to that cell on the chessboard
           [Modified from get_possible_moves]
           Input: my_position, chess_board, max steps(int)
           Output: boardsize*boardsize list of ints where ints are minimum distances from current position
        '''

        # Initiate list of visited nodes
        seen = set()
        bfs = [my_pos]
        x, y = my_pos
        seen.add((x, y))

        # Depth counter
        dist = 0
        counter = 1
        next_count = 0

        #Initiate the result chess_board and set all initial values to 2*board_size as it's the maximum distance
        rows, cols = len(chess_board), len(chess_board[0])
        board_size = max(rows, cols)
        distances = np.ones([rows, cols], dtype=int) * (2 * board_size)
        distances[x, y] = 0

        #Use bfs to find the distance
        while bfs:

            r, c = bfs.pop(0)

            if counter == 0:
                dist += 1
                counter = next_count
                next_count = 0

            if (r,c) == adv_pos:
                counter-=1
                continue

            for d in range(0, 4):
                tmp_pos = (r + self.moves[d][0], c + self.moves[d][1])
                if not chess_board[r, c, d] and tmp_pos not in seen:
                    bfs.append(tmp_pos)
                    ''' #Uncomment block to enforce a penalty for moving away
                    if tmp_pos == adv_pos and me:
                        #modify the scalar -1 for penalty increase, lower = higher penalty
                        distances[tmp_pos] = (dist + 1)*-1
                    
                    else:
                        distances[tmp_pos] = (dist + 1)
                    '''

                    #no penalty: comment out this line if enforcing penalty
                    distances[tmp_pos] = (dist + 1)


                    next_count += 1
                    seen.add(tmp_pos)
            counter -= 1
        return distances

    def calc_heuristic(self, my_pos, chess_board, adv_pos):
        '''
        A function that calculates the heuristic as distance between my position and the rest of
        the board vs the opponent's distance and the rest of the board. Uses numpy for faster
        computation.

        Input: my position, chess_board (after making a move), opponent's position
        Output: heuristic (int) for this move
        '''
        my_potential = self.distance_to_all_cells(my_pos, chess_board, adv_pos, True)
        opp_potential = self.distance_to_all_cells(adv_pos, chess_board, my_pos, False)
        return np.sum(my_potential - opp_potential)

    def set_barrier(self, r, c, dir, chess_board):
        '''Copied from world'''

        # Set the barrier to True
        chess_board[r, c, dir] = True
        # Set the opposite barrier to True
        move = self.moves[dir]
        chess_board[r + move[0], c + move[1], self.opposites[dir]] = True

    def undo(self, r, c, dir, chess_board):
        '''A function that removes a barrier'''

        # Set the barrier to False
        chess_board[r, c, dir] = False
        # Set the opposite barrier to False
        move = self.moves[dir]
        chess_board[r + move[0], c + move[1], self.opposites[dir]] = False

    def check_endgame(self, my_pos, chess_board, adv_pos):
        """
        Check if the game ends and compute the current score of the agents.

        Returns
        -------
        is_endgame : bool
            Whether the game ends.
        player_0_score : int
            The score of player 0, student_agent.
        player_1_score : int
            The score of player 1, student_agent's opponent.
        """
        rows, cols = len(chess_board), len(chess_board[0])
        
        # Union-Find
        father = dict()
        for r in range(rows):
            for c in range(cols):
                father[(r, c)] = (r, c)

        def find(pos):
            if father[pos] != pos:
                father[pos] = find(father[pos])
            return father[pos]

        def union(pos1, pos2):
            father[pos1] = pos2

        for r in range(rows):
            for c in range(cols):
                for dir, move in enumerate(
                    self.moves[1:3]
                ):  # Only check down and right
                    if chess_board[r, c, dir + 1]:
                        continue
                    pos_a = find((r, c))
                    pos_b = find((r + move[0], c + move[1]))
                    if pos_a != pos_b:
                        union(pos_a, pos_b)

        for r in range(rows):
            for c in range(cols):
                find((r, c))
        p0_r = find(tuple(my_pos))
        p1_r = find(tuple(adv_pos))
        p0_score = list(father.values()).count(p0_r)
        p1_score = list(father.values()).count(p1_r)
        if p0_r == p1_r:
            return False, p0_score, p1_score
        player_win = None
        win_blocks = -1
        if p0_score > p1_score:
            player_win = 0
            win_blocks = p0_score
        elif p0_score < p1_score:
            player_win = 1
            win_blocks = p1_score
        else:
            player_win = -1  # Tie
        '''
        if player_win >= 0:
            # someone won
        else:
            # tie
        '''
        return True, p0_score, p1_score
    
    def update_chess_board(self, move, chess_board, value):
        """
        Input:
        - move (tuple of position and direction)
        - chess_board (array): current state board
        - value (int): The value to set at the specified move (remove wall = 0, place wall = 1)

        This function updates walls on the chess board depending on the move and direction played. 
        The corresponding opposite wall is updated.
        """
        rows, cols = len(chess_board), len(chess_board[0])

        UP = self.dir_map["u"]
        RIGHT = self.dir_map["r"]
        DOWN = self.dir_map["d"]
        LEFT = self.dir_map["l"]

        position, direction = move
        # update move's wall
        chess_board[position[0]][position[1]][direction] = value
        # update move's corresponding opposite wall
        if direction == UP and position[0] > 0:
            chess_board[position[0] - 1][position[1]][DOWN] = value
        elif direction == RIGHT and position[1] < cols - 1:
            chess_board[position[0]][position[1] + 1][LEFT] = value
        elif direction == DOWN and position[0] < rows - 1:
            chess_board[position[0] + 1][position[1]][UP] = value
        elif direction == LEFT and position[1] > 0:
            chess_board[position[0]][position[1] - 1][RIGHT] = value
    
    def sorted_moves(self, valid_moves, my_pos, chess_board, adv_pos):
        """
        Sorts the valid moves based on their potential outcomes by 
        running check_endgame() on each one.

        Input:
        - valid_moves (list): A list of valid moves to consider from get_possible_moves()

        Output: 
        - wins, losses, ties, neither (all arrays containing moves --> tuple of position and direction)
        """
        wins, losses, ties, neither = ([] for _ in range(4))

        for move in valid_moves:
            (r_c,dir) = move
            move = r_c
            # Play the move on board
            self.update_chess_board((r_c,dir), chess_board, 1)
            is_endgame, p0_score, p1_score = self.check_endgame(move, chess_board, adv_pos)
            
            # Categorize the move based on the endgame()
            if not is_endgame:
                neither.append((r_c,dir))
            else:
                win_blocks = -1
                if p0_score > p1_score: # student_agent wins
                    win_blocks = p0_score
                    wins = self.insert(wins, win_blocks, (r_c,dir), ascending=False)
                elif p0_score < p1_score:
                    win_blocks = p1_score
                    losses = self.insert(losses, win_blocks, (r_c,dir), ascending=False)
                else:
                    ties.append((r_c,dir))
            # Undo the move on board
            self.update_chess_board((r_c,dir), chess_board, 0)
        wins = [move for score, move in wins]
        losses = [move for score, move in losses]

        return wins, losses, ties, neither

    def insert(self, mlist, score, move, ascending=True):
        "Sorted Insert"
        index = len(mlist)
        new_entry = (score, move)

        # Searching for the position
        if ascending:
            for i in range(len(mlist)):
                if mlist[i][0] > score:  # Compare scores
                    index = i
                    break
        else:
            for i in range(len(mlist)):
                if mlist[i][0] < score:  # Compare scores
                    index = i
                    break

        # Inserting n in the list
        if index == len(mlist):
            mlist = mlist[:index] + [new_entry]
        else:
            mlist = mlist[:index] + [new_entry] + mlist[index:]
        return mlist

    
    def best_move(self, my_pos, max_step, chess_board, adv_pos):
        ''''A function that returns the best move determined by the heuristics
        Input: current_position, max_step, chess_board, opponent's position
        Output: move in format ((int, int), int)'''

        #Generate list of possible moves
        moves = self.get_possible_moves(my_pos, max_step, chess_board, adv_pos)

        #Sort the moves into game ending and non-game ending moves
        wins, losses, ties, neither = self.sorted_moves(moves, my_pos, chess_board, adv_pos)
        sorted_moves = {"wins": wins, "losses": losses, "ties": ties, "neither": neither}
        my_move = None

        #If there are winning moves, play it
        if wins:
            return wins[0]

        #If all moves are game ending and no winning, play tie
        elif not neither and ties:
            return ties[0]

        #otherwise play only possible move
        elif not neither and not ties and losses:
            return losses[0]


        #Make heap to sort moves by heuristic
        #Us = Max player, opponent = min player
        best_moves = []
        heapq.heapify(best_moves)
        chess_board_copy = copy.deepcopy(chess_board)

        #For moves in neither, calculate the heuristic
        for m in sorted_moves["neither"]:
            coord, dir = m
            x, y = coord
            self.set_barrier(x, y, dir, chess_board_copy)
            heuristic = self.calc_heuristic(coord, chess_board_copy, adv_pos)
            heapq.heappush(best_moves, (heuristic, m))
            self.undo(x, y, dir, chess_board_copy)

        # Pop the best move from heap and check if the opponent can win immediately on their turn
        # if we play this move
        top = heapq.heappop(best_moves)
        top_coord, top_dir = top[1]
        top_x, top_y = top_coord
        self.set_barrier(top_x, top_y, top_dir, chess_board_copy)
        op_moves = self.get_possible_moves(adv_pos, max_step, chess_board_copy, top_coord)
        op_wins, op_losses, op_ties, op_neither = self.sorted_moves(op_moves, adv_pos, chess_board_copy, top_coord)
        self.undo(top_x, top_y, top_dir, chess_board_copy)

        # if yes, we play the next best move
        if op_wins and best_moves:
            top = heapq.heappop(best_moves)
            top_coord, top_dir = top[1]
            top_x, top_y = top_coord
            self.set_barrier(top_x, top_y, top_dir, chess_board_copy)
            op_moves = self.get_possible_moves(adv_pos, max_step, chess_board_copy, top_coord)
            op_wins, op_losses, op_ties, op_neither = self.sorted_moves(op_moves, adv_pos, chess_board_copy, top_coord)
            self.undo(top_x, top_y, top_dir, chess_board_copy)

        #if there's no moves left, play ties, otherwise return a losing move
        if op_wins and not best_moves and ties:
            return ties[0]

        return top[1]

    def step(self, chess_board, my_pos, adv_pos, max_step):
        """
        Implement the step function of your agent here.
        You can use the following variables to access the chess board:
        - chess_board: a numpy array of shape (x_max, y_max, 4)
        - my_pos: a tuple of (x, y)
        - adv_pos: a tuple of (x, y)
        - max_step: an integer

        You should return a tuple of ((x, y), dir),
        where (x, y) is the next position of your agent and dir is the direction of the wall
        you want to put on.

        Please check the sample implementation in agents/random_agent.py or agents/human_agent.py for more details.
        """

        # Some simple code to help you with timing. Consider checking
        # time_taken during your search and breaking with the best answer
        # so far when it nears 2 seconds.
        # print(self.get_untried_actions(my_pos, max_step, chess_board, adv_pos))
        start_time = time.time()
        time_taken = time.time() - start_time

        #print(self.distance_to_all_cells(my_pos, copy.deepcopy(chess_board), adv_pos, True))
        #print(self.distance_to_all_cells(my_pos, copy.deepcopy(chess_board), adv_pos, False))
        my_pos, a = self.best_move(my_pos, max_step, chess_board, adv_pos)
        # print("RETURNED MOVES", my_pos, a)
        #print("My AI's turn took ", time_taken, "seconds.")

        # dummy return
        return my_pos, a
