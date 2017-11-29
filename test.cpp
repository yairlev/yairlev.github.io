// main.cpp

#include <thread>
#include <iostream>
#include <mutex>
#include <deque>
#include <emscripten.h>
#include <emscripten/val.h>
#include <emscripten/bind.h>


std::mutex g_mutex;
std::condition_variable g_condition;

using emscripten::val;

struct Message {
    std::string address;
};

std::deque<Message> g_queue;


void push()
{
    while(1) {
        std::chrono::milliseconds elapsed(1000);
        std::this_thread::sleep_for(elapsed);
        std::lock_guard<std::mutex> lock(g_mutex);        
        printf("pushing message\n");
        g_queue.push_back(Message { "message" });
        g_condition.notify_all();
    }
}

void pop()
{
    while (1) {
        std::unique_lock<std::mutex> lock(g_mutex);
        printf("waiting for message\n");
        g_condition.wait(lock, [] { return !g_queue.empty(); });
        auto message = g_queue.front();
        printf("popping message: %s\n", message.address.c_str()); 
        g_queue.pop_front();
    }
}

int main()
{  
   std::thread push_t(push);
   std::thread pop_t(pop);
   push_t.join();
   pop_t.join();
}